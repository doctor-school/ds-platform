import { Injectable } from "@nestjs/common";
import type { FeatureFlags } from "../feature-flags/feature-flags.types.js";
import {
  FLAG_EMAIL_DELIVERY_REAL,
  FLAG_SMS_DELIVERY_REAL,
} from "../feature-flags/feature-flags.types.js";
import {
  SMS_DESCRIPTION_INTERCEPT,
  SMS_DESCRIPTION_REAL,
  SMTP_DESCRIPTION_INTERCEPT,
  SMTP_DESCRIPTION_REAL,
  type DeliveryAdmin,
  type ZitadelProvider,
} from "./delivery-reconcile.types.js";

/** The boot-time / Unleash-unreachable delivery defaults, sourced from env. */
export interface DeliveryEnvDefaults {
  emailReal: boolean;
  smsReal: boolean;
}

/** A diagnostic sink for the "desired provider not provisioned" skip note. */
export type WarnFn = (message: string) => void;

/**
 * Initial-reconcile resilience knobs (#214 defect B). The boot reconcile is a
 * network call to Zitadel that can fail transiently while the stand is still
 * coming up, so it is retried with a bounded linear backoff. Overridable in unit
 * tests to avoid real timers; the production default is a short, finite budget.
 */
export interface ReconcileRetryConfig {
  /** Total attempts for the initial reconcile (1 = no retry). */
  attempts: number;
  /** Base delay (ms) between attempts; multiplied by the attempt index. */
  baseDelayMs: number;
  /** Sleep primitive — injectable so tests resolve immediately. */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: ReconcileRetryConfig = {
  attempts: 5,
  baseDelayMs: 2000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Reconciles the live `email-delivery-real` / `sms-delivery-real` Unleash flags
 * onto Zitadel's **active** notification provider (#185, design of record §3).
 *
 * The api sends no OTP itself — Zitadel does, via its active provider — so a
 * delivery-mode flag cannot branch in our code; it must repoint Zitadel. This
 * service reads each flag (env default as fallback), finds the provider whose
 * stable `description` matches the desired mode among the providers
 * `provision.sh` pre-configured, and `_activate`s it. It is:
 *
 * - **idempotent** — when the desired provider is already active it does nothing
 *   (Zitadel rejects re-activating an active provider; we skip rather than rely on
 *   tolerance, though the admin adapter also tolerates the precondition error);
 * - **safe** — when the desired provider is not provisioned (e.g. real SMTP with
 *   no creds, so `provision.sh` skipped it) it leaves the channel untouched and
 *   warns; it NEVER activates the wrong provider as a fallback;
 * - **reactive** — {@link start} subscribes to flag signals (the SDK `changed`
 *   event for operator UI toggles AND the `synchronized` event for the SDK's first
 *   poll) and runs a resilient initial reconcile. The subscriptions are wired even
 *   if the initial reconcile fails, and a steady-ON flag converges on first sync
 *   without a manual toggle (#214).
 *
 * It holds NO SMTP/SMS secrets — it only flips which pre-configured provider is
 * active (the creds live in Zitadel's provider config, set by `provision.sh`).
 */
@Injectable()
export class DeliveryReconcileService {
  private unsubscribeChange: (() => void) | null = null;
  private unsubscribeSync: (() => void) | null = null;

  constructor(
    private readonly flags: FeatureFlags,
    private readonly admin: DeliveryAdmin,
    private readonly envDefaults: DeliveryEnvDefaults,
    private readonly retry: ReconcileRetryConfig = DEFAULT_RETRY,
  ) {}

  /**
   * Subscribe to flag signals, then run a resilient initial reconcile. Called
   * from the module's lifecycle hook on the dev-stand (when a live Zitadel admin
   * client is available).
   *
   * Subscriptions are wired FIRST and unconditionally (#214 defect B): a transient
   * boot-time `fetch failed` in the initial reconcile must NOT leave the process
   * deaf to flag changes for its whole lifetime. Two signals drive a re-reconcile:
   *
   * - `onChange` — an operator's UI toggle (the original reactive path); and
   * - `onSynchronized` — the SDK's first successful poll. At boot the SDK has not
   *   synced, so a flag read returns the env default; a flag that is steadily ON
   *   never emits `changed`. Re-reconciling on first sync converges a steady-ON
   *   flag without a manual toggle (#214 defect C).
   *
   * Both handlers and the initial reconcile are fire-and-forget — a failed
   * reconcile logs and is retried on the next signal; `start()` never throws (so
   * the module hook can await it without aborting boot).
   */
  async start(warn: WarnFn = defaultWarn): Promise<void> {
    const safeReconcile = (reason: string): void => {
      void this.reconcile(warn).catch((err: unknown) => {
        warn(
          `delivery reconcile failed on ${reason}: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
      });
    };
    this.unsubscribeChange = this.flags.onChange(() =>
      safeReconcile("flag change"),
    );
    this.unsubscribeSync = this.flags.onSynchronized(() =>
      safeReconcile("SDK first sync"),
    );
    await this.initialReconcile(warn);
  }

  /**
   * The boot reconcile with bounded backoff. A transient failure (stand still
   * coming up) is retried; an exhausted budget logs and returns — the env-default
   * provider stays active (fail-soft) and the next flag signal will reconcile.
   * Never throws.
   */
  private async initialReconcile(warn: WarnFn): Promise<void> {
    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      try {
        await this.reconcile(warn);
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        if (attempt >= this.retry.attempts) {
          warn(
            `initial reconcile failed after ${attempt} attempt(s): ${message} — leaving the env-default provider active; a flag change or the SDK's first sync will reconcile`,
          );
          return;
        }
        warn(
          `initial reconcile attempt ${attempt} failed: ${message} — retrying`,
        );
        await this.retry.sleep(this.retry.baseDelayMs * attempt);
      }
    }
  }

  /** Unsubscribe from flag signals (module shutdown). */
  stop(): void {
    this.unsubscribeChange?.();
    this.unsubscribeChange = null;
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
  }

  /**
   * Reconcile both channels once: read each flag (env default as fallback),
   * select the matching provider by description, and activate it if it is not
   * already active.
   */
  async reconcile(warn: WarnFn = defaultWarn): Promise<void> {
    const emailReal = this.flags.isEnabled(
      FLAG_EMAIL_DELIVERY_REAL,
      this.envDefaults.emailReal,
    );
    const smsReal = this.flags.isEnabled(
      FLAG_SMS_DELIVERY_REAL,
      this.envDefaults.smsReal,
    );

    await this.reconcileChannel(
      "SMTP",
      await this.admin.listSmtpProviders(),
      emailReal ? SMTP_DESCRIPTION_REAL : SMTP_DESCRIPTION_INTERCEPT,
      (id) => this.admin.activateSmtp(id),
      warn,
    );
    await this.reconcileChannel(
      "SMS",
      await this.admin.listSmsProviders(),
      smsReal ? SMS_DESCRIPTION_REAL : SMS_DESCRIPTION_INTERCEPT,
      (id) => this.admin.activateSms(id),
      warn,
    );
  }

  /**
   * Select the provider whose `description` matches `wantDescription` and
   * activate it unless it is already active. A missing match is a no-op + warn
   * (never activate the wrong provider).
   */
  private async reconcileChannel(
    channel: "SMTP" | "SMS",
    providers: ZitadelProvider[],
    wantDescription: string,
    activate: (id: string) => Promise<void>,
    warn: WarnFn,
  ): Promise<void> {
    const target = providers.find((p) => p.description === wantDescription);
    if (!target) {
      warn(
        `${channel} delivery: no provider matching "${wantDescription}" is provisioned — leaving the active provider unchanged (re-run provision.sh / configure the real provider's creds to enable it)`,
      );
      return;
    }
    if (target.active) return; // idempotent: already the active provider.
    await activate(target.id);
  }
}

/** Default warn sink — stderr, so the skip note is visible in the api logs. */
function defaultWarn(message: string): void {
  console.warn(`[delivery-reconcile] ${message}`);
}

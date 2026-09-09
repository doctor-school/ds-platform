import { resolveRealSmtp, type RealSmtpEnv } from "../config/real-smtp.js";
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
  realSmtp?: RealSmtpEnv;
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
 * Reconciles native Zitadel login-OTP SMTP and SMS providers on flag signals.
 * BFF verify/reset sends use MailerModule instead. Explicit real SMTP validates
 * shared configuration and the provisioned identity before activation, including
 * already-active providers. It never repairs credentials or sends mail itself.
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

  /** Subscribe before bounded startup reconciliation; real-email failure aborts boot. */
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

  /** Retry transient startup failures; retain legacy fail-soft behavior only in intercept. */
  private async initialReconcile(warn: WarnFn): Promise<void> {
    for (let attempt = 1; attempt <= this.retry.attempts; attempt++) {
      try {
        await this.reconcile(warn);
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        if (attempt >= this.retry.attempts) {
          if (
            this.flags.isEnabled(
              FLAG_EMAIL_DELIVERY_REAL,
              this.envDefaults.emailReal,
            )
          )
            throw err;
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

    const real = emailReal
      ? resolveRealSmtp(this.envDefaults.realSmtp ?? {})
      : null;
    const smtp = await this.admin.listSmtpProviders();
    if (real) {
      const targets = smtp.filter(
        (p) => p.description === SMTP_DESCRIPTION_REAL,
      );
      const target = targets[0];
      if (
        targets.length !== 1 ||
        !target?.id ||
        target.host !== `${real.host}:${real.port}` ||
        target.tls !== true ||
        target.user !== real.user ||
        target.senderAddress !== real.from
      ) {
        throw new Error(
          "Native SMTP configuration does not match selected provider; re-provision required",
        );
      }
    }
    await this.reconcileChannel(
      "SMTP",
      smtp,
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

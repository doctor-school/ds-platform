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
 * - **reactive** — {@link start} runs an initial reconcile and subscribes to the
 *   SDK `changed` event so an operator's UI toggle drives an `_activate` without
 *   a restart.
 *
 * It holds NO SMTP/SMS secrets — it only flips which pre-configured provider is
 * active (the creds live in Zitadel's provider config, set by `provision.sh`).
 */
@Injectable()
export class DeliveryReconcileService {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly flags: FeatureFlags,
    private readonly admin: DeliveryAdmin,
    private readonly envDefaults: DeliveryEnvDefaults,
  ) {}

  /**
   * Run an initial reconcile, then subscribe to flag changes. Called from the
   * module's lifecycle hook on the dev-stand (when a live Zitadel admin client is
   * available). The change handler is fire-and-forget — a failed reconcile logs
   * and is retried on the next change; it never throws into the SDK emitter.
   */
  async start(warn: WarnFn = defaultWarn): Promise<void> {
    await this.reconcile(warn);
    this.unsubscribe = this.flags.onChange(() => {
      void this.reconcile(warn).catch((err: unknown) => {
        warn(
          `delivery reconcile failed on flag change: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
      });
    });
  }

  /** Unsubscribe from flag changes (module shutdown). */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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

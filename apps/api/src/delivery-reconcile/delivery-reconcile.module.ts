import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
import { FEATURE_FLAGS } from "../feature-flags/feature-flags.tokens.js";
import type { FeatureFlags } from "../feature-flags/feature-flags.types.js";
import { DeliveryReconcileService } from "./delivery-reconcile.service.js";
import { ZitadelDeliveryAdmin } from "./zitadel-delivery-admin.js";

/** DI token for the optional reconcile service (absent without a live Zitadel admin). */
export const DELIVERY_RECONCILE = Symbol("DELIVERY_RECONCILE");

/**
 * Wires the delivery reconcile (#185, design §3): the live `email-delivery-real`
 * / `sms-delivery-real` Unleash flags → Zitadel's active notification provider.
 *
 * The reconcile is bound ONLY when a real Zitadel admin client is configured
 * (`IDP_ISSUER` + `IDP_SERVICE_TOKEN` — the same env the {@link IdpModule} uses to
 * pick the real adapter over the fake). Without them (the shared-CI / fake-IdP
 * default) the token resolves to `null` and no reconcile runs — there is no live
 * Zitadel to repoint, so the boot-time env mode stands (the documented fallback).
 *
 * Lifecycle: {@link onApplicationBootstrap} runs the initial reconcile and
 * subscribes to flag changes (so an operator's UI toggle drives an `_activate`
 * without a restart); {@link onModuleDestroy} unsubscribes. Shutdown hooks are
 * enabled in `main.ts`.
 */
@Module({
  providers: [
    {
      provide: DELIVERY_RECONCILE,
      inject: [FEATURE_FLAGS],
      useFactory: (flags: FeatureFlags): DeliveryReconcileService | null => {
        const env = loadEnv();
        if (!env.IDP_ISSUER || !env.IDP_SERVICE_TOKEN) return null;
        const admin = new ZitadelDeliveryAdmin({
          baseUrl: env.IDP_ISSUER,
          serviceToken: env.IDP_SERVICE_TOKEN,
        });
        return new DeliveryReconcileService(flags, admin, {
          emailReal: env.EMAIL_DELIVERY_MODE === "real",
          smsReal: env.SMS_DELIVERY_MODE === "real",
        });
      },
    },
  ],
})
export class DeliveryReconcileModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  constructor(
    @Inject(DELIVERY_RECONCILE)
    private readonly reconcile: DeliveryReconcileService | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Fire-and-forget the initial reconcile + subscribe; a failure here must not
    // abort boot (the env mode is the safe fallback). The service logs its own
    // skip/error notes.
    if (!this.reconcile) return;
    await this.reconcile.start().catch((err: unknown) => {
      console.warn(
        `[delivery-reconcile] initial reconcile failed: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    });
  }

  onModuleDestroy(): void {
    this.reconcile?.stop();
  }
}

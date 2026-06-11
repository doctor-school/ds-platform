import { Global, Module } from "@nestjs/common";
import { initialize, type Unleash } from "unleash-client";
import { loadEnv } from "../config/env.schema.js";
import { FeatureFlagsService } from "./feature-flags.service.js";
import { FEATURE_FLAGS } from "./feature-flags.tokens.js";

/**
 * Wires the runtime feature-flag port (#185, design §1).
 *
 * Binds {@link FEATURE_FLAGS} to a {@link FeatureFlagsService} wrapping the
 * Unleash **server SDK**. The SDK is initialised **only when** `UNLEASH_URL` and
 * `UNLEASH_API_TOKEN` are both configured (the dev-stand recipe — the seeded
 * backend/client token). With either unset (the shared-CI / Unleash-less default)
 * the service is bound with a `null` client, so the api boots and every flag read
 * resolves to the caller's env default — the documented Unleash-unreachable
 * fallback (design §4), fail-closed for the security flag at its call site.
 *
 * `@Global` so the bot-protection provider and the delivery reconcile inject the
 * port without re-importing — mirrors {@link BotProtectionModule}/{@link IdpModule}.
 *
 * The SDK init is non-blocking: `initialize` returns immediately and polls in the
 * background. A flag read before the first sync returns the env fallback (the SDK
 * fallback-value contract), so there is no boot race. Shutdown is handled by the
 * service's `onModuleDestroy` (Nest shutdown hooks, enabled in `main.ts`).
 */
@Global()
@Module({
  providers: [
    {
      provide: FEATURE_FLAGS,
      useFactory: (): FeatureFlagsService => {
        const env = loadEnv();
        if (!env.UNLEASH_URL || !env.UNLEASH_API_TOKEN) {
          // Env-only fallback mode: no live SDK, reads return env defaults.
          return new FeatureFlagsService(null);
        }
        const client: Unleash = initialize({
          url: env.UNLEASH_URL,
          appName: env.UNLEASH_APP_NAME,
          environment: env.UNLEASH_ENVIRONMENT,
          // The backend/client token authenticates the SDK→Unleash poll. Unleash
          // expects it in the Authorization header (no Bearer prefix).
          customHeaders: { Authorization: env.UNLEASH_API_TOKEN },
          // A short refresh so an operator's UI toggle takes effect on the
          // dev-stand within seconds (the per-request captcha read and the
          // delivery `changed` reconcile both ride this poll).
          refreshInterval: env.UNLEASH_REFRESH_INTERVAL_MS,
          // The SDK logs an `error` event on a failed poll; swallow it so an
          // unreachable Unleash degrades to the env fallback quietly rather than
          // crashing the unhandled-error path. Reads already fail-soft.
        });
        client.on("error", () => undefined);
        return new FeatureFlagsService(client);
      },
    },
  ],
  exports: [FEATURE_FLAGS],
})
export class FeatureFlagsModule {}

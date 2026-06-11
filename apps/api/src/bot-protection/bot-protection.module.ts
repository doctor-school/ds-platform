import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadEnv } from "../config/env.schema.js";
import { FEATURE_FLAGS } from "../feature-flags/feature-flags.tokens.js";
import {
  FLAG_BOT_PROTECTION,
  type FeatureFlags,
} from "../feature-flags/feature-flags.types.js";
import { BotProtectionGuard } from "./bot-protection.guard.js";
import { BOT_PROTECTION } from "./bot-protection.tokens.js";
import { SmartCaptchaProvider } from "./smart-captcha.provider.js";

/**
 * Wires bot protection (design §10.1; #185 live-flag migration):
 *
 * - binds the {@link BOT_PROTECTION} interface token to the Yandex SmartCaptcha
 *   adapter from env config — the single place a provider swap (DSO-26) happens;
 * - the master switch is read **live per request** from the Unleash
 *   `bot-protection` flag, NOT baked in at module init (#185): the factory passes
 *   an `isEnabled` callback that reads {@link FEATURE_FLAGS} on every verify, with
 *   `BOT_PROTECTION_ENABLED` as the **fail-closed** env fallback (Unleash
 *   unreachable MUST NOT silently open the gate, design §4). So an operator
 *   toggling the flag in the admin UI changes behaviour without a restart;
 * - registers {@link BotProtectionGuard} globally so any `@BotProtected` handler
 *   is gated without per-controller `@UseGuards` wiring.
 *
 * `@Global` so the {@link BOT_PROTECTION} token is injectable from feature
 * modules (003 F1/F5/F6) without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: BOT_PROTECTION,
      inject: [FEATURE_FLAGS],
      useFactory: (flags: FeatureFlags): SmartCaptchaProvider => {
        const env = loadEnv();
        return new SmartCaptchaProvider({
          // Live read on every verify: Unleash overrides env when reachable; env
          // (`BOT_PROTECTION_ENABLED`) is the bootstrap default AND the
          // fail-closed fallback when Unleash is down.
          isEnabled: () =>
            flags.isEnabled(FLAG_BOT_PROTECTION, env.BOT_PROTECTION_ENABLED),
          serverKey: env.SMARTCAPTCHA_SERVER_KEY,
          validateUrl: env.SMARTCAPTCHA_VALIDATE_URL,
        });
      },
    },
    { provide: APP_GUARD, useClass: BotProtectionGuard },
  ],
  exports: [BOT_PROTECTION],
})
export class BotProtectionModule {}

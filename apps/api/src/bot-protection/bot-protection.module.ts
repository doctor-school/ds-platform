import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadEnv } from "../config/env.schema.js";
import { BotProtectionGuard } from "./bot-protection.guard.js";
import { BOT_PROTECTION } from "./bot-protection.tokens.js";
import { SmartCaptchaProvider } from "./smart-captcha.provider.js";

/**
 * Wires bot protection (design §10.1):
 *
 * - binds the {@link BOT_PROTECTION} interface token to the Yandex SmartCaptcha
 *   adapter from env config — the single place a provider swap (DSO-26) happens;
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
      useFactory: (): SmartCaptchaProvider => {
        const env = loadEnv();
        return new SmartCaptchaProvider({
          enabled: env.BOT_PROTECTION_ENABLED,
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

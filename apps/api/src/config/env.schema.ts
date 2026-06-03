import { z } from "zod";

import { SMARTCAPTCHA_VALIDATE_URL } from "../bot-protection/smart-captcha.provider.js";

export const ApiEnvSchema = z.looseObject({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),

  // Bot protection (Yandex SmartCaptcha — design §10.1, ADR-0001 open-q #7).
  // Disabled by default so the dev-stand runs without a Yandex account; the
  // guard and widget stay wired, only the server-to-server validation is
  // skipped. Enable in any environment that holds a real SmartCaptcha keypair.
  BOT_PROTECTION_ENABLED: z
    .stringbool({ truthy: ["true", "1"], falsy: ["false", "0", ""] })
    .default(false),
  SMARTCAPTCHA_SERVER_KEY: z.string().optional(),
  SMARTCAPTCHA_VALIDATE_URL: z.url().default(SMARTCAPTCHA_VALIDATE_URL),

  // Identity provider (Zitadel — design §1/§2). The BFF binds the real Zitadel
  // adapter only when a service token is present; with no token (the dev-stand
  // default — `IDP_CLIENT_SECRET` is empty) it falls back to the in-memory fake
  // so the F1 flows run end-to-end against a real Postgres without a live IdP.
  IDP_ISSUER: z.string().optional(),
  IDP_SERVICE_TOKEN: z.string().optional(),
  // Shared secret authenticating the Zitadel Action webhook (EARS-19). The
  // webhook fails closed when this is unset — an unauthenticated mirror-write
  // surface is never opened by default.
  IDP_WEBHOOK_SECRET: z.string().optional(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return ApiEnvSchema.parse(source);
}

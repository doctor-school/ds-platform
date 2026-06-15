import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env.schema.js";
import { MAILER, type Mailer } from "./mailer.types.js";
import { SmtpMailer } from "./smtp-mailer.js";
import {
  InMemoryRegisterNoticeThrottle,
  RedisRegisterNoticeThrottle,
  REGISTER_NOTICE_THROTTLE,
  type RegisterNoticeThrottle,
  type ThrottleRedisLike,
} from "./register-notice-throttle.js";

/** Mirrors the audit ledger's fail-closed / VITEST-fallback pepper rule (#141). */
const TEST_FALLBACK_PEPPER = "test-only-insecure-audit-identifier-pepper";

/** Default portal origin for the notice links when `MAILER_PORTAL_BASE_URL` is unset. */
const DEFAULT_PORTAL_BASE_URL = "http://localhost:3001";

/**
 * Resolve the throttle HMAC pepper. Reuses {@link AUDIT_IDENTIFIER_PEPPER} so the
 * `register-notice:<HMAC>` key is non-reversible (#141); under VITEST a fixed
 * test pepper keeps the suite runnable without provisioning a secret. Unlike the
 * audit ledger this does NOT fail closed when unset in a non-test runtime: an
 * absent pepper only means the throttle key is keyed by the empty-string pepper —
 * the notice path is itself infra-gated (no SMTP host ⇒ logged no-op), so a
 * misconfigured runtime degrades gracefully rather than refusing to boot.
 */
function resolvePepper(): string {
  const pepper = loadEnv().AUDIT_IDENTIFIER_PEPPER;
  if (pepper) return pepper;
  if (process.env.VITEST) return TEST_FALLBACK_PEPPER;
  return "";
}

/**
 * The BFF transactional-email channel (003 EARS-23, design §4) — distinct from
 * Zitadel's identity-credential emails. Provides:
 *
 * - {@link MAILER} → {@link SmtpMailer} over nodemailer, config-gated by
 *   `MAILER_SMTP_*`; a logged no-op when unconfigured (infra-gated, like the
 *   IdP / Redis fakes). The unit specs wire {@link FakeMailer} directly.
 * - {@link REGISTER_NOTICE_THROTTLE} → the Redis-backed per-address throttle when
 *   `REDIS_URL` is set (the production binding), else the in-memory fake — the
 *   single place the throttle backend is chosen, mirroring `SessionModule`.
 *
 * Both are exported so `AuthService` (AuthModule) consumes them.
 */
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: (): Mailer => {
        const env = loadEnv();
        return new SmtpMailer({
          host: env.MAILER_SMTP_HOST,
          port: env.MAILER_SMTP_PORT,
          user: env.MAILER_SMTP_USER,
          password: env.MAILER_SMTP_PASSWORD,
          from: env.MAILER_SMTP_FROM,
          portalBaseUrl: env.MAILER_PORTAL_BASE_URL ?? DEFAULT_PORTAL_BASE_URL,
        });
      },
    },
    {
      provide: REGISTER_NOTICE_THROTTLE,
      useFactory: (): RegisterNoticeThrottle => {
        const env = loadEnv();
        const pepper = resolvePepper();
        if (env.REDIS_URL) {
          const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
          const logger = new Logger("RegisterNoticeThrottle");
          redis.on("error", (e: Error) =>
            logger.error(`redis connection error: ${e.message}`),
          );
          return new RedisRegisterNoticeThrottle(
            redis as unknown as ThrottleRedisLike,
            pepper,
          );
        }
        return new InMemoryRegisterNoticeThrottle(pepper);
      },
    },
  ],
  exports: [MAILER, REGISTER_NOTICE_THROTTLE],
})
export class MailerModule {}

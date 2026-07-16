import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv, type ApiEnv } from "../config/env.schema.js";
import { FEATURE_FLAGS } from "../feature-flags/feature-flags.tokens.js";
import {
  FLAG_EMAIL_DELIVERY_REAL,
  type FeatureFlags,
} from "../feature-flags/feature-flags.types.js";
import { MAILER, type Mailer } from "./mailer.types.js";
import { SmtpMailer, type SmtpTransportConfig } from "./smtp-mailer.js";
import {
  InMemoryRegisterNoticeThrottle,
  RedisRegisterNoticeThrottle,
  REGISTER_NOTICE_THROTTLE,
  type RegisterNoticeThrottle,
  type ThrottleRedisLike,
} from "./register-notice-throttle.js";

/** Mirrors the audit ledger's fail-closed / VITEST-fallback pepper rule (#141). */
const TEST_FALLBACK_PEPPER = "test-only-insecure-audit-identifier-pepper";

/**
 * Default portal origin when `MAILER_PORTAL_BASE_URL` is unset — the notice
 * links here AND the Zitadel verification email's bare `/verify` navigation
 * URL (`IdpModule`, #869) share this single portal-origin source.
 */
export const DEFAULT_PORTAL_BASE_URL = "http://localhost:3001";

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
 * Resolve the REAL transport config from `IDP_SMTP_REAL_*` (#209), reusing the
 * IdP's real-SMTP creds class. `IDP_SMTP_REAL_HOST` carries `host:port`; a bare
 * host falls back to `IDP_SMTP_REAL_PORT` (mirrors provision.sh). Returns
 * `undefined` when the host is unset — a flag-ON send then fails soft to the
 * Mailpit intercept + warns (never throws).
 */
function resolveRealTransport(env: ApiEnv): SmtpTransportConfig | undefined {
  const raw = env.IDP_SMTP_REAL_HOST;
  if (!raw) return undefined;
  const [host, portFromHost] = raw.split(":", 2);
  const port = portFromHost
    ? Number.parseInt(portFromHost, 10)
    : env.IDP_SMTP_REAL_PORT;
  return {
    host,
    port: port && Number.isFinite(port) ? port : undefined,
    user: env.IDP_SMTP_REAL_USER,
    password: env.IDP_SMTP_REAL_PASSWORD,
    from: env.IDP_SMTP_REAL_SENDER_ADDRESS,
  };
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
      // FEATURE_FLAGS is @Global (#185) ⇒ injectable here without re-importing
      // (mirror BotProtectionModule). The factory passes a LIVE `email-delivery-real`
      // read so a flag flip switches the notice transport with no restart (#209).
      inject: [FEATURE_FLAGS],
      useFactory: (flags: FeatureFlags): Mailer => {
        const env = loadEnv();
        return new SmtpMailer({
          intercept: {
            host: env.MAILER_SMTP_HOST,
            port: env.MAILER_SMTP_PORT,
            user: env.MAILER_SMTP_USER,
            password: env.MAILER_SMTP_PASSWORD,
            from: env.MAILER_SMTP_FROM,
          },
          real: resolveRealTransport(env),
          // Resend failover channel (003 design §14.3, EARS-31): configured ⇔
          // RESEND_API_KEY is set; sits strictly BEHIND the mail.ru primary in
          // the per-send chain. From reuses the DKIM-aligned sender address.
          resend: env.RESEND_API_KEY
            ? {
                apiKey: env.RESEND_API_KEY,
                from: env.IDP_SMTP_REAL_SENDER_ADDRESS,
              }
            : undefined,
          // Live read on every send: Unleash overrides when reachable; the
          // EMAIL_DELIVERY_MODE env default ("real") is the boot default AND the
          // Unleash-unreachable fallback (same contract as DeliveryReconcileService).
          isEnabled: () =>
            flags.isEnabled(
              FLAG_EMAIL_DELIVERY_REAL,
              env.EMAIL_DELIVERY_MODE === "real",
            ),
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

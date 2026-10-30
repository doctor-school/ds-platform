import { Global, Logger, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Redis } from "ioredis";
import { loadEnv } from "../../config/env.schema.js";
import { resolveAuditPepper } from "../session/auth-audit.ledger.js";
import { SessionModule } from "../session/session.module.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
import { InMemoryRateLimitStore } from "./rate-limit.store.fake.js";
import { RATE_LIMIT_STORE, type RateLimitStore } from "./rate-limit.store.js";
import {
  RedisRateLimitStore,
  type RateLimitRedisLike,
} from "./rate-limit.store.redis.js";
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_THRESHOLDS,
  resolveRateLimitThresholds,
  type Clock,
  type RateLimitThresholds,
} from "./rate-limit.types.js";

/**
 * Wires the EARS-13 auth rate limiter (ADR-0001 §7):
 *
 * - provides {@link RateLimitService} with the EARS-13 thresholds bound as an
 *   injectable value — the EARS-13 defaults, each ceiling overridable per env var
 *   for an ops / load-test window (#1076; a deployment tightens them, the e2e
 *   rebinds to drive the boundary) — and `Date.now` as the clock (a fake in the
 *   unit spec);
 * - binds the windows' {@link RATE_LIMIT_STORE} to Redis when `REDIS_URL` is
 *   set (#3539: shared by every replica, kept across restarts), else memory;
 * - registers {@link RateLimitGuard} globally so any `@RateLimited` handler is
 *   gated without per-controller `@UseGuards` wiring; it appends a refused
 *   `@PasswordLoginDoor` request to the AUTH_AUDIT ledger (003 EARS-15).
 *
 * `@Global` + exported so the service is injectable/rebindable from feature
 * modules and tests, like {@link BotProtectionModule}.
 */
@Global()
@Module({
  // The guard's AUTH_AUDIT sink (003 EARS-15 throttled password logins).
  imports: [SessionModule],
  providers: [
    RateLimitService,
    {
      // #1076: the EARS-13 defaults, each ceiling env-overridable for an
      // ops / load-test window. A malformed / ≤0 / non-integer var is ignored
      // with one loud warn and the default kept for that field — never an
      // unlimited state, never a boot crash (see `resolveRateLimitThresholds`).
      provide: RATE_LIMIT_THRESHOLDS,
      useFactory: (): RateLimitThresholds => {
        const logger = new Logger(RateLimitModule.name);
        return resolveRateLimitThresholds(loadEnv(), ({ envVar, rawValue }) =>
          logger.warn(
            `${envVar}=${JSON.stringify(rawValue)} is not a positive integer; ignoring the override and keeping the EARS-13 default for that ceiling.`,
          ),
        );
      },
    },
    {
      provide: RATE_LIMIT_STORE,
      useFactory: (): RateLimitStore => {
        const env = loadEnv();
        if (!env.REDIS_URL) return new InMemoryRateLimitStore();
        // lazyConnect + error listener: the OTP-challenge store's discipline.
        const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
        const logger = new Logger("RedisRateLimitStore");
        redis.on("error", (e: Error) =>
          logger.error(`redis connection error: ${e.message}`),
        );
        return new RedisRateLimitStore(
          redis as unknown as RateLimitRedisLike,
          resolveAuditPepper(),
        );
      },
    },
    { provide: RATE_LIMIT_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}

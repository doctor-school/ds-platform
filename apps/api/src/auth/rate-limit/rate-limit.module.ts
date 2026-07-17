import { Global, Logger, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { loadEnv } from "../../config/env.schema.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
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
 * - registers {@link RateLimitGuard} globally so any `@RateLimited` handler is
 *   gated without per-controller `@UseGuards` wiring.
 *
 * `@Global` + exported so the service is injectable/rebindable from feature
 * modules and tests, like {@link BotProtectionModule}.
 */
@Global()
@Module({
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
    { provide: RATE_LIMIT_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}

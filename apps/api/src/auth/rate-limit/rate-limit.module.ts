import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
import {
  DEFAULT_RATE_LIMIT_THRESHOLDS,
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_THRESHOLDS,
  type Clock,
} from "./rate-limit.types.js";

/**
 * Wires the EARS-13 auth rate limiter (ADR-0001 §7):
 *
 * - provides {@link RateLimitService} with the EARS-13 default thresholds bound
 *   as an injectable value (a deployment tightens them; the e2e rebinds to drive
 *   the boundary) and `Date.now` as the clock (a fake in the unit spec);
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
    { provide: RATE_LIMIT_THRESHOLDS, useValue: DEFAULT_RATE_LIMIT_THRESHOLDS },
    { provide: RATE_LIMIT_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}

import { SetMetadata } from "@nestjs/common";
import {
  TIMING_EQUALIZED_KEY,
  type TimingEqualizedOptions,
} from "./timing-equalization.types.js";

/**
 * `@TimingEqualized()` — floor a handler's response time so the existing-account
 * and unknown-account paths are indistinguishable by latency (EARS-16).
 *
 * The global {@link TimingEqualizationInterceptor} no-ops on any handler without
 * this metadata (additive, like `@RateLimited` / `@BotProtected`). Mark the
 * enumeration-sensitive surfaces — register, login, password-reset — where a
 * success path and a generic-failure path do measurably different work.
 *
 * Called bare, the route is floored to the module's default floor. Pass
 * `floorMs` when the route's heaviest branch runs PAST that default: a floor
 * below the heavier branch pads neither branch and equalises nothing (044
 * EARS-7 — the congress intake creates an IdP user and a whole transaction on
 * one branch and resolves an existing account on the other, both far past the
 * 40 ms auth-door default). The value may be a READER rather than a number when
 * the floor is server configuration, because this argument is evaluated once at
 * class-definition time while configuration is read per request.
 */
export function TimingEqualized(
  options?: TimingEqualizedOptions,
): MethodDecorator & ClassDecorator {
  return SetMetadata(TIMING_EQUALIZED_KEY, options ?? true);
}

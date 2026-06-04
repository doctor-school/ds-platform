import { SetMetadata } from "@nestjs/common";
import { TIMING_EQUALIZED_KEY } from "./timing-equalization.types.js";

/**
 * `@TimingEqualized()` — floor a handler's response time so the existing-account
 * and unknown-account paths are indistinguishable by latency (EARS-16).
 *
 * The global {@link TimingEqualizationInterceptor} no-ops on any handler without
 * this metadata (additive, like `@RateLimited` / `@BotProtected`). Mark the
 * enumeration-sensitive surfaces — register, login, password-reset — where a
 * success path and a generic-failure path do measurably different work.
 */
export function TimingEqualized(): MethodDecorator & ClassDecorator {
  return SetMetadata(TIMING_EQUALIZED_KEY, true);
}

import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TimingEqualizationInterceptor } from "./timing-equalization.interceptor.js";
import {
  DEFAULT_TIMING_FLOOR_MS,
  TIMING_CLOCK,
  TIMING_FLOOR_MS,
  type Clock,
} from "./timing-equalization.types.js";

/**
 * Wires the EARS-16 timing-equalization interceptor (ADR-0001 §7):
 *
 * - binds the floor to the {@link DEFAULT_TIMING_FLOOR_MS} default as an
 *   injectable value (a deployment raises it; tests rebind it);
 * - binds `Date.now` as the clock (a fake in the unit spec);
 * - registers {@link TimingEqualizationInterceptor} globally so any
 *   `@TimingEqualized` handler is floored without per-controller wiring.
 *
 * `@Global` so the tokens are rebindable from feature modules / tests.
 */
@Global()
@Module({
  providers: [
    { provide: TIMING_FLOOR_MS, useValue: DEFAULT_TIMING_FLOOR_MS },
    { provide: TIMING_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    { provide: APP_INTERCEPTOR, useClass: TimingEqualizationInterceptor },
  ],
})
export class TimingEqualizationModule {}

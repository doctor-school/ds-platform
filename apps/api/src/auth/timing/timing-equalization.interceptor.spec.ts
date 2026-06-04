import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import {
  firstValueFrom,
  lastValueFrom,
  map,
  of,
  timer,
  throwError,
  type Observable,
} from "rxjs";
import { TimingEqualizationInterceptor } from "./timing-equalization.interceptor.js";

// EARS-16: the timing-equalization interceptor floors a decorated response —
// success AND failure — to a fixed minimum, so the existing-account and
// unknown-account paths (which do different amounts of work) resolve at ≈ the
// same time and their latency delta collapses to ≤ 50 ms. Proven here at the
// interceptor altitude because the fake IdP has no realistic existing-vs-unknown
// timing gap to mask — the interceptor's flooring is the actual mechanism.
describe("TimingEqualizationInterceptor (EARS-16)", () => {
  const FLOOR = 60;

  /** A context whose reflector reports the handler as `@TimingEqualized`. */
  const markedContext = {
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const markedReflector = {
    getAllAndOverride: () => true,
  } as unknown as Reflector;

  function interceptor(now: () => number): TimingEqualizationInterceptor {
    return new TimingEqualizationInterceptor(FLOOR, now, markedReflector);
  }

  /** Wall-clock the observable from subscribe to terminal (value or error). */
  async function timeIt(run: () => Promise<unknown>): Promise<number> {
    const start = Date.now();
    await run().catch(() => undefined);
    return Date.now() - start;
  }

  it("EARS-16: floors a fast success path up to the timing floor", async () => {
    const next: CallHandler = { handle: () => of("ok") };
    const elapsed = await timeIt(() =>
      firstValueFrom(
        interceptor(() => Date.now()).intercept(markedContext, next),
      ),
    );
    // The handler returns immediately, but the response is held until the floor.
    expect(elapsed).toBeGreaterThanOrEqual(FLOOR - 5);
  });

  it("EARS-16: equalizes a fast path and a slower path to within the 50 ms budget", async () => {
    const fast: CallHandler = { handle: () => of("unknown-account") };
    const slow: CallHandler = {
      // Models the existing-account path doing ~25 ms more work before resolving.
      handle: () => timer(25).pipe(map(() => "existing-account")),
    };
    const tFast = await timeIt(() =>
      firstValueFrom(
        interceptor(() => Date.now()).intercept(markedContext, fast),
      ),
    );
    const tSlow = await timeIt(() =>
      firstValueFrom(
        interceptor(() => Date.now()).intercept(markedContext, slow),
      ),
    );
    // Both floored to ≈ FLOOR; the existence-revealing delta is gone.
    expect(Math.abs(tSlow - tFast)).toBeLessThanOrEqual(50);
  });

  it("EARS-16: floors the FAILURE path too (the success-vs-failure oracle is the one that matters)", async () => {
    const failing: CallHandler = {
      handle: () => throwError(() => new Error("generic failure")),
    };
    const obs = interceptor(() => Date.now()).intercept(
      markedContext,
      failing,
    ) as Observable<unknown>;
    let threw = false;
    const elapsed = await timeIt(async () => {
      try {
        await lastValueFrom(obs);
      } catch {
        threw = true;
        throw new Error("rethrow");
      }
    });
    expect(threw).toBe(true); // the error still propagates …
    expect(elapsed).toBeGreaterThanOrEqual(FLOOR - 5); // … but only after the floor.
  });

  it("EARS-16: a path already past the floor is not delayed further", async () => {
    // Clock jumps past the floor between start and terminal: no extra pad added.
    let t = 1000;
    const jumpingNow = (): number => t;
    const next: CallHandler = {
      handle: () => {
        t += FLOOR + 100; // the handler "took" longer than the floor
        return of("ok");
      },
    };
    const elapsed = await timeIt(() =>
      firstValueFrom(interceptor(jumpingNow).intercept(markedContext, next)),
    );
    // Real wall time is ~0 because the floor was already exceeded on the fake clock.
    expect(elapsed).toBeLessThan(FLOOR);
  });

  it("does not touch an unmarked handler", async () => {
    const unmarkedReflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const itc = new TimingEqualizationInterceptor(
      FLOOR,
      () => Date.now(),
      unmarkedReflector,
    );
    const next: CallHandler = { handle: () => of("immediate") };
    const elapsed = await timeIt(() =>
      firstValueFrom(itc.intercept(markedContext, next)),
    );
    expect(elapsed).toBeLessThan(FLOOR); // passed straight through, no floor
  });
});

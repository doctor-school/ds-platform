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

  // 044 EARS-7 (#2300): the ONE global floor of 40 ms equalises nothing on the
  // congress intake — both of its branches (create an IdP user and a whole
  // transaction, versus resolve an existing account and attach a registration)
  // run well past it, so the floor pads neither and the latency delta is the
  // full work difference. A floor only equalises when it sits ABOVE the heavier
  // branch, and that value is route-specific: the auth doors keep theirs, the
  // intake gets its own. These three prove the override mechanism — a marked
  // route WITHOUT options is byte-identical to before, and a marked route WITH
  // one is floored to its own value on the value AND the error branch.
  describe("route-specific floor (044 EARS-7)", () => {
    const ROUTE_FLOOR = 160;

    function withMetadata(
      metadata: unknown,
      now: () => number = () => Date.now(),
    ): TimingEqualizationInterceptor {
      return new TimingEqualizationInterceptor(FLOOR, now, {
        getAllAndOverride: () => metadata,
      } as unknown as Reflector);
    }

    it("EARS-7: a marked route with no options keeps the default floor", async () => {
      const next: CallHandler = { handle: () => of("ok") };
      const elapsed = await timeIt(() =>
        firstValueFrom(withMetadata(true).intercept(markedContext, next)),
      );
      expect(elapsed).toBeGreaterThanOrEqual(FLOOR - 5);
      // Not raised to anything else: the auth doors are untouched by 044.
      expect(elapsed).toBeLessThan(ROUTE_FLOOR);
    });

    it("EARS-7: a route-specific floor is honoured on the success path", async () => {
      const next: CallHandler = { handle: () => of("accepted") };
      const elapsed = await timeIt(() =>
        firstValueFrom(
          withMetadata({ floorMs: ROUTE_FLOOR }).intercept(markedContext, next),
        ),
      );
      expect(elapsed).toBeGreaterThanOrEqual(ROUTE_FLOOR - 5);
    });

    it("EARS-7: a route-specific floor is honoured on the error path too", async () => {
      const failing: CallHandler = {
        handle: () => throwError(() => new Error("generic refusal")),
      };
      const obs = withMetadata({ floorMs: ROUTE_FLOOR }).intercept(
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
      // The refusal of a misconfigured intake must not come back faster than an
      // acceptance — that is the same oracle, one layer down.
      expect(threw).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(ROUTE_FLOOR - 5);
    });

    it("EARS-7: a floor supplied as a thunk is resolved per request", async () => {
      // How the congress route carries an ENV-configured floor through a static
      // decorator argument: the metadata holds the reader, not the number, so an
      // operator who raises the floor needs no redeploy.
      let configured = 20;
      const itc = withMetadata({ floorMs: () => configured });
      const next: CallHandler = { handle: () => of("ok") };

      const quick = await timeIt(() =>
        firstValueFrom(itc.intercept(markedContext, next)),
      );
      configured = ROUTE_FLOOR;
      const slow = await timeIt(() =>
        firstValueFrom(itc.intercept(markedContext, next)),
      );

      expect(quick).toBeLessThan(ROUTE_FLOOR);
      expect(slow).toBeGreaterThanOrEqual(ROUTE_FLOOR - 5);
    });
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

import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  catchError,
  concatMap,
  of,
  throwError,
  timer,
  type Observable,
} from "rxjs";
import {
  TIMING_CLOCK,
  TIMING_EQUALIZED_KEY,
  TIMING_FLOOR_MS,
  type Clock,
} from "./timing-equalization.types.js";

/**
 * Global EARS-16 timing-equalization interceptor (ADR-0001 §7).
 *
 * For a handler marked `@TimingEqualized`, it floors the total response time to
 * {@link TIMING_FLOOR_MS} on **both** branches — the success value and a thrown
 * error (the enumeration oracle is precisely success-vs-failure, and failures
 * throw). Both paths therefore resolve at ≈ the floor and the existing/unknown
 * delta collapses to scheduling jitter (≤ 50 ms). It pads *up* only: a path that
 * already exceeds the floor is emitted immediately (the floor must be set above
 * the heaviest path for the guarantee to hold — see {@link DEFAULT_TIMING_FLOOR_MS}).
 *
 * Constructor ordering: both `@Inject` params precede the type-inferred
 * `Reflector` (with a `new Reflector()` default for direct construction) — the
 * tsx/esbuild `design:paramtypes` hazard the endpoint-authz gate trips on.
 */
@Injectable()
export class TimingEqualizationInterceptor implements NestInterceptor {
  constructor(
    @Inject(TIMING_FLOOR_MS) private readonly floorMs: number,
    @Inject(TIMING_CLOCK) private readonly now: Clock,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      TIMING_EQUALIZED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!marked) return next.handle();

    const start = this.now();
    // Delay the terminal signal (value or error) until the floor is reached. The
    // remaining pad is computed when the signal arrives, so it accounts for the
    // handler's own elapsed time.
    const padUntilFloor = <T>(project: () => Observable<T>): Observable<T> => {
      const remaining = Math.max(0, this.floorMs - (this.now() - start));
      return timer(remaining).pipe(concatMap(project));
    };

    return next.handle().pipe(
      concatMap((value) => padUntilFloor(() => of(value))),
      catchError((err: unknown) => padUntilFloor(() => throwError(() => err))),
    );
  }
}

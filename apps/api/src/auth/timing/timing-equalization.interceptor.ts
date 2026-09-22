import {
  Inject,
  Injectable,
  Logger,
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
  type TimingEqualizedMetadata,
} from "./timing-equalization.types.js";

/**
 * Global EARS-16 timing-equalization interceptor (ADR-0001 §7).
 *
 * For a handler marked `@TimingEqualized`, it floors the total response time on
 * **both** branches — the success value and a thrown error (the enumeration
 * oracle is precisely success-vs-failure, and failures throw). Both paths
 * therefore resolve at ≈ the floor and the existing/unknown delta collapses to
 * scheduling jitter (≤ 50 ms). It pads *up* only: a path that already exceeds
 * the floor is emitted immediately, which is why the floor must sit ABOVE the
 * heaviest branch for the guarantee to hold.
 *
 * Which floor applies is a per-ROUTE question, not a global one: the auth doors
 * are all under {@link DEFAULT_TIMING_FLOOR_MS}, while the 044 congress intake
 * has one branch that creates an IdP user and one that resolves an existing
 * account, both far past it (EARS-7). A route therefore may carry its own floor
 * in the decorator metadata — as a number, or as a reader when the value is
 * server configuration — and this stays ONE global interceptor either way.
 *
 * Constructor ordering: both `@Inject` params precede the type-inferred
 * `Reflector` (with a `new Reflector()` default for direct construction) — the
 * tsx/esbuild `design:paramtypes` hazard the endpoint-authz gate trips on.
 */
@Injectable()
export class TimingEqualizationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimingEqualizationInterceptor.name);

  constructor(
    @Inject(TIMING_FLOOR_MS) private readonly floorMs: number,
    @Inject(TIMING_CLOCK) private readonly now: Clock,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const marked = this.reflector.getAllAndOverride<
      TimingEqualizedMetadata | undefined
    >(TIMING_EQUALIZED_KEY, [context.getHandler(), context.getClass()]);
    if (!marked) return next.handle();

    const floorMs = this.resolveFloor(marked);
    const start = this.now();
    // Delay the terminal signal (value or error) until the floor is reached. The
    // remaining pad is computed when the signal arrives, so it accounts for the
    // handler's own elapsed time.
    const padUntilFloor = <T>(project: () => Observable<T>): Observable<T> => {
      const remaining = Math.max(0, floorMs - (this.now() - start));
      return timer(remaining).pipe(concatMap(project));
    };

    return next.handle().pipe(
      concatMap((value) => padUntilFloor(() => of(value))),
      catchError((err: unknown) => padUntilFloor(() => throwError(() => err))),
    );
  }

  /**
   * The floor this route runs on. Resolved BEFORE the handler, so the pad is
   * measured from the same instant on every branch.
   *
   * A reader that throws or answers with a non-finite number falls back to the
   * injected default rather than failing the request: the floor is a privacy
   * measure, and a broken configuration must not turn it into an outage. The
   * fallback is logged because it silently weakens the guarantee it protects.
   */
  private resolveFloor(marked: TimingEqualizedMetadata): number {
    if (marked === true) return this.floorMs;
    const configured = marked.floorMs;
    if (configured == null) return this.floorMs;
    if (typeof configured === "number") return configured;
    try {
      const read = configured();
      if (Number.isFinite(read)) return read;
      this.logger.warn(
        "timing floor reader returned a non-finite value; using the default floor",
      );
    } catch {
      this.logger.warn(
        "timing floor reader threw; using the default floor",
      );
    }
    return this.floorMs;
  }
}

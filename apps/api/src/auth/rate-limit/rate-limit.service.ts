import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_SENDING_DOOR_RATE_LIMIT_BUCKET,
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_THRESHOLDS,
  type Clock,
  type RateLimitContext,
  type RateLimitReceipt,
  type RateLimitThresholds,
} from "./rate-limit.types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** One fixed window's live state: how many hits, and when the window rolls over. */
interface Window {
  count: number;
  resetAtMs: number;
}

/** A dimension to evaluate for one attempt: its counter map, key, window, ceiling. */
interface Dimension {
  map: Map<string, Window>;
  key: string;
  windowMs: number;
  limit: number;
}

/**
 * Key a SOURCE-ADDRESS dimension (per-IP, per-ASN) inside its bucket (#1646).
 *
 * No bucket => the bare address: the 003 verification doors' per-IP window and
 * the per-ASN window both auth doors share (003 EARS-13). A bucket (a scope, or
 * the sending doors' bucket) => the
 * address namespaced under the tag, joined by a separator that occurs in
 * neither an IP nor an `x-asn` value, so a scoped key can never collide with an
 * unscoped one, nor one scope with another, whatever tag a future call site picks.
 */
const SCOPE_SEPARATOR = "\u0000";

function scoped(scope: string | undefined, address: string): string {
  return scope === undefined ? address : `${scope}${SCOPE_SEPARATOR}${address}`;
}

/**
 * EARS-13 auth rate limiter (ADR-0001 §7).
 *
 * Owns three fixed-window counters — per-user (the submitted identifier,
 * 15 min), per-IP (15 min), per-ASN (hourly). {@link tryConsume} answers one
 * question per attempt: may this request proceed? It is allowed only when
 * **every applicable window has room**; a refused request consumes **nothing**
 * (so a single over-limit dimension cannot spuriously burn the others).
 *
 * The per-IP window splits by auth door (#2684): a verification door keys it on
 * the bare address and, on success, gives its own unit back
 * ({@link refundIpUnit}), so that window counts failed verifications; a sending
 * door keys it under its own bucket with its own ceiling. The per-ASN window is
 * shared by both doors.
 *
 * The source-address counters are keyed inside the caller's optional
 * {@link RateLimitContext.scope} bucket (#1646): a scoped consumer gets a
 * disjoint window, so a non-auth route can neither exhaust the auth doors'
 * per-IP windows nor be exhausted by them (003 EARS-13). This is
 * the request-rate sibling of {@link SmsBudgetService}; the same fixed-window
 * shape, gating every decorated auth endpoint.
 *
 * State is in-memory: correct for a single BFF instance. A multi-instance
 * deployment shares the counters through the same Redis the session store uses;
 * that backing rebinds this service without touching the guard call site
 * (mirroring the SESSION_STORE fake/Redis split) — the documented EARS-13
 * distributed-limit seam.
 */
@Injectable()
export class RateLimitService {
  private readonly byUser = new Map<string, Window>();
  private readonly byIp = new Map<string, Window>();
  private readonly byAsn = new Map<string, Window>();

  constructor(
    @Inject(RATE_LIMIT_THRESHOLDS)
    private readonly thresholds: RateLimitThresholds,
    @Inject(RATE_LIMIT_CLOCK) private readonly now: Clock,
  ) {}

  /**
   * EARS-13: may this attempt proceed? Returns `true` and consumes one unit from
   * every applicable window only when none would exceed its ceiling; otherwise
   * returns `false` and consumes nothing. The per-user and per-ASN windows are
   * evaluated only when their key is supplied (an identifier-less endpoint or a
   * missing edge `x-asn` simply skips that dimension).
   */
  tryConsume(ctx: RateLimitContext): boolean {
    return this.consume(ctx) !== null;
  }

  /**
   * {@link tryConsume} that also hands back a receipt naming the per-IP window
   * the unit was taken from (`null` when refused). A refund presents it, so a
   * success gives back the unit it consumed rather than one from a window that
   * opened after it (003 EARS-13, #2684).
   */
  consume(ctx: RateLimitContext): RateLimitReceipt | null {
    const t = this.now();
    // #2684: an unscoped SENDING door keys its per-IP window under its own
    // bucket (60 / 15 min); every other attempt keeps the caller's scope.
    const ipBucket =
      ctx.scope ??
      (ctx.door === "sending"
        ? AUTH_SENDING_DOOR_RATE_LIMIT_BUCKET
        : undefined);
    const dims: Dimension[] = [
      {
        map: this.byIp,
        key: scoped(ipBucket, ctx.ip),
        windowMs: FIFTEEN_MIN_MS,
        limit: this.perIpLimit(ipBucket),
      },
    ];
    if (ctx.identifier !== undefined) {
      dims.push({
        map: this.byUser,
        key: ctx.identifier.toLowerCase(),
        windowMs: FIFTEEN_MIN_MS,
        limit: this.thresholds.perUserPer15Min,
      });
    }
    if (ctx.asn !== undefined) {
      dims.push({
        map: this.byAsn,
        key: scoped(ctx.scope, ctx.asn),
        windowMs: HOUR_MS,
        limit: this.thresholds.perAsnPerHour,
      });
    }

    // Phase 1 — check every window before mutating any, so a request refused on
    // the last dimension does not leave the earlier ones spuriously incremented.
    for (const d of dims) {
      if (this.current(d, t) >= d.limit) return null;
    }
    // Phase 2 — allowed: consume one unit from each window.
    for (const d of dims) this.bump(d, t);
    const ipWindow = this.byIp.get(dims[0]!.key)!;
    return { ipWindowResetAtMs: ipWindow.resetAtMs };
  }

  /**
   * 011 EARS-7: consume one unit from the **per-user window only**, for a subject
   * the *handler* resolved rather than the request body.
   *
   * `tryConsume` derives its per-user key from the submitted `identifier` /
   * `email` / `phone` field, which is right for every 003 endpoint and silently
   * wrong for the 011 TOTP verifies: their body is `{ code }` and nothing else, so
   * decorating them with `@RateLimited()` engages the per-IP and per-ASN windows
   * and skips the per-user one entirely — the ADR-0001 §7 ceiling that actually
   * bounds guessing against ONE account. The identifier those endpoints must be
   * keyed by is not in the request at all; it is bound into the server-side
   * pending-auth record at primary auth, and only the handler can read it.
   *
   * This method is that second phase, deliberately narrow: the per-IP / per-ASN
   * windows have already been consumed by the guard for this request, so
   * re-evaluating them here would double-count. Keyed identically to
   * `tryConsume`'s per-user dimension (lower-cased), which is what makes the
   * budget genuinely **shared** with primary auth and across both verify
   * endpoints (011 design §6) rather than three parallel allowances.
   */
  tryConsumeUser(identifier: string): boolean {
    const dimension: Dimension = {
      map: this.byUser,
      key: identifier.toLowerCase(),
      windowMs: FIFTEEN_MIN_MS,
      limit: this.thresholds.perUserPer15Min,
    };
    const t = this.now();
    if (this.current(dimension, t) >= dimension.limit) return false;
    this.bump(dimension, t);
    return true;
  }

  /**
   * #222 (EARS-13): forgive the **per-user** window for this attempt's identifier
   * — clear the counter so a recovering user who just succeeded starts fresh. Only
   * the per-user dimension is cleared (keyed identically to {@link tryConsume}'s
   * lower-cased identifier); the per-IP and per-ASN windows are deliberately left
   * intact here: a success gives back at most its OWN per-IP unit
   * ({@link refundIpUnit}, #2684), never an origin's / network's broader budget
   * (an attacker spraying identifiers from one IP still hits the per-IP ceiling
   * of failed verifications). An identifier-less context (no per-user key) is a
   * no-op.
   */
  reset(ctx: RateLimitContext): void {
    if (ctx.identifier === undefined) return;
    this.byUser.delete(ctx.identifier.toLowerCase());
  }

  /**
   * EARS-13 (#2684): a VERIFICATION door that succeeded gives back the one
   * per-IP unit its own request consumed, so the bare-address window counts
   * failed verifications only. It is a refund of one unit, never a clear: the
   * failures already in the window stay, so interleaving one valid account's
   * successes cannot buy an origin extra failed guesses. The sending doors'
   * window, the per-user window (see {@link reset}) and the per-ASN window are
   * untouched. The refund names the window its unit came from
   * (`consumedWindowResetAtMs`, the guard's receipt): if that window has since
   * rolled over — or no receipt exists — there is nothing of this request's to
   * give back, and decrementing the fresh window would erase a failure.
   */
  refundIpUnit(ip: string, consumedWindowResetAtMs: number | undefined): void {
    if (consumedWindowResetAtMs === undefined) return;
    const w = this.byIp.get(scoped(undefined, ip));
    if (
      w === undefined ||
      w.resetAtMs !== consumedWindowResetAtMs ||
      this.now() >= w.resetAtMs ||
      w.count === 0
    ) {
      return;
    }
    w.count--;
  }

  /**
   * The per-address ceiling this bucket is held to (#2294): the scope's own
   * number when it declares one, the platform ceiling otherwise — so an
   * unscoped auth request and a scope with no entry are both unchanged.
   */
  private perIpLimit(scope: string | undefined): number {
    if (scope === undefined) return this.thresholds.perIpPer15Min;
    return (
      this.thresholds.scopedPerIpPer15Min[scope] ??
      this.thresholds.perIpPer15Min
    );
  }

  /** Current count in the dimension's live window (0 if absent or rolled over). */
  private current(d: Dimension, t: number): number {
    const w = d.map.get(d.key);
    return w === undefined || t >= w.resetAtMs ? 0 : w.count;
  }

  /** Consume one unit, opening a fresh window if none is live. */
  private bump(d: Dimension, t: number): void {
    const w = d.map.get(d.key);
    if (w === undefined || t >= w.resetAtMs) {
      d.map.set(d.key, { count: 1, resetAtMs: t + d.windowMs });
    } else {
      w.count++;
    }
  }
}

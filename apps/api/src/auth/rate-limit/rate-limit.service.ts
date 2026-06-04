import { Inject, Injectable } from "@nestjs/common";
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_THRESHOLDS,
  type Clock,
  type RateLimitContext,
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
 * EARS-13 auth rate limiter (ADR-0001 §7).
 *
 * Owns three fixed-window counters — per-user (the submitted identifier,
 * 15 min), per-IP (15 min), per-ASN (hourly). {@link tryConsume} answers one
 * question per attempt: may this request proceed? It is allowed only when
 * **every applicable window has room**; a refused request consumes **nothing**
 * (so a single over-limit dimension cannot spuriously burn the others). This is
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
    const t = this.now();
    const dims: Dimension[] = [
      {
        map: this.byIp,
        key: ctx.ip,
        windowMs: FIFTEEN_MIN_MS,
        limit: this.thresholds.perIpPer15Min,
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
        key: ctx.asn,
        windowMs: HOUR_MS,
        limit: this.thresholds.perAsnPerHour,
      });
    }

    // Phase 1 — check every window before mutating any, so a request refused on
    // the last dimension does not leave the earlier ones spuriously incremented.
    for (const d of dims) {
      if (this.current(d, t) >= d.limit) return false;
    }
    // Phase 2 — allowed: consume one unit from each window.
    for (const d of dims) this.bump(d, t);
    return true;
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

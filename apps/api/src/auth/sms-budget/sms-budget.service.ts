import { Inject, Injectable } from "@nestjs/common";
import {
  SMS_BUDGET_CLOCK,
  SMS_BUDGET_THRESHOLDS,
  type Clock,
  type SmsBudgetThresholds,
  type SmsSendContext,
} from "./sms-budget.types.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** One fixed window's live state: how many sends, and when the window rolls over. */
interface Window {
  count: number;
  resetAtMs: number;
}

/** A dimension to evaluate for one attempted send: its counter map, key, window, ceiling. */
interface Dimension {
  map: Map<string, Window>;
  key: string;
  windowMs: number;
  limit: number;
}

/**
 * EARS-14 SMS toll-fraud budget (design §10, §2).
 *
 * Owns four fixed-window counters — per-phone (hourly), per-IP (hourly), per-ASN
 * (hourly), and a global daily circuit-breaker. {@link tryConsume} answers one
 * question per attempted send: may this SMS go out? It is allowed only when
 * **every applicable window has room**, and a refused send consumes **nothing**
 * (the SMS never reached the provider, so no budget is spent). Refusing fail-
 * closed without sending is the whole point: a `globalPerDay` of 0 is a tripped
 * breaker that refuses the first send.
 *
 * State is in-memory: correct for a single BFF instance and for the F3 flows
 * (proven here + in the OTP e2e). A multi-instance deployment shares the budget
 * through the same Redis the session store uses; that backing is the F6 (#90)
 * rate-limit concern (EARS-13) and rebinds this counter without touching the
 * call sites — mirroring the SESSION_STORE fake/Redis split.
 */
@Injectable()
export class SmsBudgetService {
  private readonly byPhone = new Map<string, Window>();
  private readonly byIp = new Map<string, Window>();
  private readonly byAsn = new Map<string, Window>();
  private readonly global = new Map<string, Window>();

  // Constructor ordering note: both params are `@Inject`-ed (no type-inferred
  // class dependency), so the tsx/esbuild `design:paramtypes` ordering hazard
  // that bites AuthController/AuthService does not apply here.
  constructor(
    @Inject(SMS_BUDGET_THRESHOLDS)
    private readonly thresholds: SmsBudgetThresholds,
    @Inject(SMS_BUDGET_CLOCK) private readonly now: Clock,
  ) {}

  /**
   * EARS-14: may an SMS be sent for this `(phone, ip, asn)`? Returns `true` and
   * consumes one unit from every applicable window only when none would exceed
   * its ceiling; otherwise returns `false` and consumes nothing. The per-ASN
   * window is evaluated only when an ASN is supplied (design §2 — edge concern).
   */
  tryConsume(ctx: SmsSendContext): boolean {
    const t = this.now();
    const dims: Dimension[] = [
      {
        map: this.byPhone,
        key: ctx.phone,
        windowMs: HOUR_MS,
        limit: this.thresholds.perPhonePerHour,
      },
      {
        map: this.byIp,
        key: ctx.ip,
        windowMs: HOUR_MS,
        limit: this.thresholds.perIpPerHour,
      },
      {
        map: this.global,
        key: "global",
        windowMs: DAY_MS,
        limit: this.thresholds.globalPerDay,
      },
    ];
    if (ctx.asn !== undefined) {
      dims.push({
        map: this.byAsn,
        key: ctx.asn,
        windowMs: HOUR_MS,
        limit: this.thresholds.perAsnPerHour,
      });
    }

    // Phase 1 — check every window before mutating any, so a send refused on the
    // last dimension does not leave the earlier ones spuriously incremented.
    for (const d of dims) {
      if (this.current(d, t) >= d.limit) return false;
    }
    // Phase 2 — the send is allowed: consume one unit from each window.
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

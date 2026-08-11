import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Clock } from "../rate-limit/rate-limit.types.js";

/**
 * Failed second-factor verifications that trip the soft-lock — ADR-0001 §7's
 * `10 failed`, applied to the TOTP surfaces by EARS-7. Shared across the
 * enrollment verify and the challenge verify: splitting them would double an
 * attacker's budget for free (011 design §6).
 */
export const MFA_LOCKOUT_THRESHOLD = 10;

/** The §7 lockout window — and the soft-lock's own duration (design §6). */
export const MFA_LOCKOUT_WINDOW_MS = 30 * 60 * 1000;

/**
 * DI token for the injected {@link Clock} (defaults to `Date.now`; a fake in
 * tests). Declared ABOVE the class: `@Inject()` runs at class-definition time, so
 * a token declared after the class would be read inside its temporal dead zone.
 */
export const MFA_LOCKOUT_CLOCK = Symbol("MFA_LOCKOUT_CLOCK");

/**
 * 011 EARS-7 second-factor lockout (ADR-0001 §7: _10 failed / 30 min → soft-lock
 * + notification_).
 *
 * **Why the BFF owns this counter, unlike 003's password lockout.** On the
 * password path Zitadel's native policy both counts and locks, and `apps/api`
 * only *observes* the verdict (`AccountLocked` → `auth.lockout.triggered`). There
 * is no equivalent per-subject TOTP-attempt lock the BFF can read back: the IdP's
 * TOTP verify answers a bare accept/refuse. So a lockout that exists only in the
 * ADR would be a clause with nothing behind it — the AGENTS.md §6 untracked-seam
 * shape. This service is the counter, and it is deliberately the ONLY place the
 * threshold and window are written down.
 *
 * **Distinct from the rate limiter, not a duplicate of it.** `RateLimitService`
 * bounds request *rate* per identifier / IP / ASN in a 15-minute window and
 * answers a 429; this bounds *failed second-factor attempts per subject* over 30
 * minutes and produces an account state — a soft-lock that survives a fresh
 * login, a new pending reference, and a different IP, and that refuses a
 * **correct** code. Collapsing them would mean either a rate limit an attacker
 * resets by re-logging-in, or a lockout that a legitimate operator's page reloads
 * could trip.
 *
 * **Keyed by IdP subject.** Not by identifier, not by pending reference: the
 * reference rotates on every login, so keying on it would hand an attacker a free
 * budget reset for the price of one extra password POST — exactly the hole the
 * per-user rate-limit wiring closes on the other dimension.
 *
 * State is in-memory: correct for a single BFF instance, and the documented
 * distributed seam is the same one `RateLimitService` names — a Redis-backed
 * counter rebinds this service without touching a call site.
 */
@Injectable()
export class MfaLockoutService {
  /** Per-subject live window: how many failures, and when the window rolls over. */
  private readonly windows = new Map<
    string,
    { count: number; resetAtMs: number }
  >();

  constructor(
    @Optional()
    @Inject(MFA_LOCKOUT_CLOCK)
    private readonly now: Clock = () => Date.now(),
  ) {}

  /**
   * Is `sub` currently soft-locked? The lock IS the window: once the count has
   * reached the threshold the subject stays locked for the remainder of the
   * 30-minute window, then starts clean. This is checked BEFORE the code is sent
   * to the IdP, so a locked account's correct code is never even verified — the
   * EARS-7 invariant "the lock beats a correct code" is structural, not a branch
   * someone can forget after the verify.
   */
  isLocked(sub: string): boolean {
    return this.live(sub) >= MFA_LOCKOUT_THRESHOLD;
  }

  /**
   * Count one failed verification against `sub` and report the resulting state.
   *
   * `justLocked` is true for **exactly one** attempt per lock — the one that
   * crosses the threshold. It is what keeps the ledger's one-row-per-lifecycle
   * -event discipline honest (one `auth.lockout.triggered`, not one per
   * subsequent attempt) and stops the notification mail from becoming a mail
   * bomb an attacker can aim at an operator's inbox by continuing to guess.
   */
  recordFailure(sub: string): { locked: boolean; justLocked: boolean } {
    const t = this.now();
    const window = this.windows.get(sub);
    const count =
      window === undefined || t >= window.resetAtMs ? 1 : window.count + 1;
    this.windows.set(sub, {
      count,
      resetAtMs:
        window === undefined || t >= window.resetAtMs
          ? t + MFA_LOCKOUT_WINDOW_MS
          : window.resetAtMs,
    });
    return {
      locked: count >= MFA_LOCKOUT_THRESHOLD,
      justLocked: count === MFA_LOCKOUT_THRESHOLD,
    };
  }

  /**
   * Forget `sub`'s failure tally — called on a SATISFIED factor. An operator who
   * fat-fingered a few codes and then proved possession must not carry that debt
   * into their next login; the counter exists to bound guessing, and a proven
   * factor is the end of the guess. (The per-IP rate-limit window is deliberately
   * NOT forgiven here, mirroring `RateLimitService.reset`: a success must not
   * refund an origin's broader budget.)
   */
  clear(sub: string): void {
    this.windows.delete(sub);
  }

  /** Failures inside the currently live window (0 if none or rolled over). */
  private live(sub: string): number {
    const window = this.windows.get(sub);
    if (window === undefined || this.now() >= window.resetAtMs) return 0;
    return window.count;
  }
}

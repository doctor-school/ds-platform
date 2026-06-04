import { Inject, Injectable } from "@nestjs/common";
import {
  LOGIN_CHALLENGE_CLOCK,
  LOGIN_CHALLENGE_CONFIG,
  type Clock,
  type LoginChallengeConfig,
} from "./login-challenge.types.js";

/** One origin's live failure window: how many fails, and when it rolls over. */
interface Window {
  count: number;
  resetAtMs: number;
}

/**
 * EARS-17 login-challenge policy (design §10.1).
 *
 * Tracks failed logins per origin (the client IP) in a fixed window.
 * {@link isChallenged} reads the count without mutating it — the guard asks
 * before the handler runs whether this origin must solve a captcha;
 * {@link recordFailure} / {@link reset} are driven by the login *outcome* (the
 * guard cannot know it yet). A successful login clears the window, so a user who
 * mistyped a few times and then succeeds is not challenged on their next visit.
 *
 * In-memory, single-instance — the same Redis-backed seam as the rate limiter
 * and SMS budget for a multi-instance deployment (EARS-13), rebound without
 * touching the guard.
 */
@Injectable()
export class LoginChallengePolicy {
  private readonly byKey = new Map<string, Window>();

  constructor(
    @Inject(LOGIN_CHALLENGE_CONFIG)
    private readonly config: LoginChallengeConfig,
    @Inject(LOGIN_CHALLENGE_CLOCK) private readonly now: Clock,
  ) {}

  /** Has this origin failed enough times (within the window) to require a challenge? */
  isChallenged(key: string): boolean {
    return this.liveCount(key) >= this.config.threshold;
  }

  /** Tally one failed login for this origin, opening a fresh window if none is live. */
  recordFailure(key: string): void {
    const t = this.now();
    const w = this.byKey.get(key);
    if (w === undefined || t >= w.resetAtMs) {
      this.byKey.set(key, { count: 1, resetAtMs: t + this.config.windowMs });
    } else {
      w.count++;
    }
  }

  /** Clear this origin's failure window (a successful login is the all-clear). */
  reset(key: string): void {
    this.byKey.delete(key);
  }

  /** Current failure count in the live window (0 if absent or rolled over). */
  private liveCount(key: string): number {
    const w = this.byKey.get(key);
    return w === undefined || this.now() >= w.resetAtMs ? 0 : w.count;
  }
}

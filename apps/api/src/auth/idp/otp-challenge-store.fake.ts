import type {
  OtpChallenge,
  OtpChallengeStore,
} from "./otp-challenge-store.types.js";

/**
 * In-memory {@link OtpChallengeStore} — the default binding when no `REDIS_URL`
 * is configured (the dev-stand / CI `api-e2e` default, exactly as
 * {@link InMemorySessionStore} stands in for Redis there).
 *
 * A plain `Map`, deliberately WITHOUT a TTL sweep: it preserves the exact
 * semantics of the instance Map it replaced (#410) — an armed challenge lives
 * until consumed on a successful verify, and Zitadel alone owns code expiry,
 * attempt limits, and lockout (never reimplement an IdP primitive, EARS-15). A
 * single-process store cannot grow past the rate-limited `request*Otp` surface,
 * so the Redis adapter's garbage-collection TTL has no in-memory counterpart.
 */
export class InMemoryOtpChallengeStore implements OtpChallengeStore {
  private readonly challenges = new Map<string, OtpChallenge>();

  set(key: string, challenge: OtpChallenge): Promise<void> {
    this.challenges.set(key, challenge);
    return Promise.resolve();
  }

  get(key: string): Promise<OtpChallenge | undefined> {
    return Promise.resolve(this.challenges.get(key));
  }

  delete(key: string): Promise<void> {
    this.challenges.delete(key);
    return Promise.resolve();
  }
}

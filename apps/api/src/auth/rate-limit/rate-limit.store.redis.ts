import { createHmac } from "node:crypto";
import type {
  RateLimitStore,
  RateLimitStoreResult,
  RateLimitWindowSpec,
} from "./rate-limit.store.js";

/**
 * The slice of a Redis client this store needs — narrowed (as the session and
 * OTP-challenge stores narrow `ioredis`) so the adapter stays a thin wrapper.
 * `ioredis`'s `eval`, `set(key, val, "PX", ms, "NX")` and `del` satisfy it.
 */
export interface RateLimitRedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
}

/** Key namespace for the EARS-13 windows. */
const KEY_PREFIX = "ds:rate-limit:";

/**
 * Check-then-take over every window in ONE script, so a refused attempt takes
 * nothing and two replicas cannot both take the last unit (Redis runs a script
 * atomically). A window is a hash `{c: count, r: resetAtMs}` read on the
 * limiter's clock (ARGV[1]), so a window rolls over exactly as the in-memory
 * store's does; PEXPIRE only garbage-collects a dead window.
 * ARGV = now, then per key: windowMs, limit.
 */
const CONSUME = `
local now = tonumber(ARGV[1])
for i = 1, #KEYS do
  local w = redis.call('HMGET', KEYS[i], 'c', 'r')
  local r = tonumber(w[2])
  if r and now < r and tonumber(w[1]) >= tonumber(ARGV[2 * i + 1]) then
    return {0, i - 1, r}
  end
end
local out = {1}
for i = 1, #KEYS do
  local w = redis.call('HMGET', KEYS[i], 'c', 'r')
  local r = tonumber(w[2])
  if r and now < r then
    redis.call('HINCRBY', KEYS[i], 'c', 1)
  else
    local len = tonumber(ARGV[2 * i])
    r = now + len
    redis.call('HSET', KEYS[i], 'c', 1, 'r', r)
    redis.call('PEXPIRE', KEYS[i], len)
  end
  out[#out + 1] = r
end
return out
`;

/** Give one unit back to the live window rolling over at ARGV[2], if it holds one. */
const REFUND = `
local w = redis.call('HMGET', KEYS[1], 'c', 'r')
local r = tonumber(w[2])
if r and r == tonumber(ARGV[2]) and tonumber(ARGV[1]) < r and tonumber(w[1]) > 0 then
  redis.call('HINCRBY', KEYS[1], 'c', -1)
end
return 0
`;

/**
 * Redis-backed {@link RateLimitStore} (#3539) — the production binding, bound
 * by {@link RateLimitModule} only when `REDIS_URL` is set. The windows survive
 * an api restart or deploy and are shared by every replica, which the IdP
 * lockout's removal (003 EARS-15) requires of the only guessing bound left.
 *
 * Keys are `ds:rate-limit:<HMAC-SHA256(pepper, key)>`, the audit pepper's
 * construction (`hashIdentifier`), so Redis never holds a raw identifier or
 * address. A Redis error propagates, as in every other Redis-backed auth store:
 * the attempt fails and is never admitted unbounded.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RateLimitRedisLike,
    private readonly pepper: string,
  ) {}

  async consume(
    specs: readonly RateLimitWindowSpec[],
    nowMs: number,
  ): Promise<RateLimitStoreResult> {
    const args: (string | number)[] = [
      ...specs.map((s) => this.key(s.key)),
      nowMs,
    ];
    for (const s of specs) args.push(s.windowMs, s.limit);
    const raw = (await this.redis.eval(
      CONSUME,
      specs.length,
      ...args,
    )) as number[];
    if (raw[0] === 0) {
      return { allowed: false, index: raw[1]!, resetAtMs: raw[2]! };
    }
    return { allowed: true, resetAtMs: raw.slice(1) };
  }

  async claimTrip(
    key: string,
    resetAtMs: number,
    nowMs: number,
  ): Promise<boolean> {
    const res = await this.redis.set(
      `${this.key(key)}:trip:${resetAtMs}`,
      "1",
      "PX",
      Math.max(1, resetAtMs - nowMs),
      "NX",
    );
    return res === "OK";
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  async refund(
    key: string,
    consumedResetAtMs: number,
    nowMs: number,
  ): Promise<void> {
    await this.redis.eval(REFUND, 1, this.key(key), nowMs, consumedResetAtMs);
  }

  private key(key: string): string {
    return `${KEY_PREFIX}${createHmac("sha256", this.pepper).update(key).digest("hex")}`;
  }
}

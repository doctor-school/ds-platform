import { createHash, randomBytes } from "node:crypto";

/**
 * 003 EARS-44 / 044 EARS-39 — the Congress sign-in hand-off reference store.
 *
 * An accepted Congress sign-up mints an opaque reference; `/login` redeems it to
 * have the account's own login code sent to the account's own address, without
 * the visitor typing it again. The reference is 32 random bytes (base64url) and
 * carries NO data — no account id, time or ordering — so nothing decodes it and
 * it leaks no existence or age signal. Only `SHA-256(ref)` is stored, mapped to
 * `{accountId, identifier, redemptions}` — `identifier` is the address exactly
 * as typed in the sign-up form, so a redemption names back what the visitor
 * typed and never the stored account's spelling (the letter case of
 * `users.email` would otherwise tell an existing account from a new one) —
 * with a 24 h TTL counted from the sign-up; a
 * reference redeems at most {@link LOGIN_HANDOFF_MAX_REDEMPTIONS} times. There is
 * no signing secret and no env key: the state lives only in the store.
 *
 * The reference itself is never persisted or logged — callers hand it straight
 * to the response (mint) or to {@link LoginHandoffStore.redeem}.
 */
export interface LoginHandoffStore {
  /**
   * Mint a fresh reference for `accountId`, remembering `identifier` — the
   * address exactly as typed in the sign-up form; returns the reference in clear.
   */
  mint(accountId: string, identifier: string): Promise<string>;
  /**
   * Count one redemption of `ref`. Returns the account id and the as-typed
   * identifier for a live reference (known hash, within the TTL, this
   * redemption ≤ the maximum); `null` for a malformed, unknown, expired or
   * exhausted one — indistinguishably.
   */
  redeem(ref: string): Promise<LoginHandoffEntry | null>;
}

/** What a live reference names: the account and the address as typed at sign-up. */
export interface LoginHandoffEntry {
  accountId: string;
  identifier: string;
}

/** DI token for the {@link LoginHandoffStore} port. */
export const LOGIN_HANDOFF_STORE = Symbol("LOGIN_HANDOFF_STORE");

/** 24 h, counted from the sign-up that minted the reference. */
export const LOGIN_HANDOFF_TTL_SECONDS = 24 * 60 * 60;

/** A reference redeems (sends a code) at most this many times. */
export const LOGIN_HANDOFF_MAX_REDEMPTIONS = 3;

/** 32 random bytes in base64url (no padding) are exactly 43 characters. */
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Key namespace of the hashed reference. */
const KEY_PREFIX = "login-handoff:";

/** A fresh opaque reference: 32 random bytes, base64url. */
export function newHandoffReference(): string {
  return randomBytes(32).toString("base64url");
}

/** True when `ref` has the shape of a minted reference (anything else is refused unread). */
export function isWellFormedHandoffReference(ref: string): boolean {
  return REFERENCE_PATTERN.test(ref);
}

/** The store key of `ref`: `login-handoff:<SHA-256(ref) hex>` — never the reference itself. */
export function handoffKey(ref: string): string {
  return `${KEY_PREFIX}${createHash("sha256").update(ref).digest("hex")}`;
}

/**
 * The slice of an ioredis client the store needs: Redis `EVAL` — server-side
 * Lua, NOT JavaScript `eval`. Only the two fixed scripts below are ever sent;
 * caller data travels as KEYS/ARGV, never spliced into the script text.
 */
export interface HandoffRedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

/** Mint: write `{accountId, identifier, redemptions: 0}` and its TTL in one step. */
const MINT_SCRIPT = `
redis.call('HSET', KEYS[1], 'accountId', ARGV[1], 'identifier', ARGV[2], 'redemptions', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

/**
 * Redeem atomically: a missing (unknown or expired) key answers nil WITHOUT
 * creating it, so a guessed reference never leaves state behind; otherwise the
 * counter is bumped and `{accountId, identifier}` returned only while it stays
 * within the maximum. The TTL is never extended.
 */
const REDEEM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local n = redis.call('HINCRBY', KEYS[1], 'redemptions', 1)
if n > tonumber(ARGV[1]) then return false end
return redis.call('HMGET', KEYS[1], 'accountId', 'identifier')
`;

/** Redis-backed {@link LoginHandoffStore} — the production binding. */
export class RedisLoginHandoffStore implements LoginHandoffStore {
  constructor(private readonly redis: HandoffRedisLike) {}

  async mint(accountId: string, identifier: string): Promise<string> {
    const ref = newHandoffReference();
    await this.redis.eval(
      MINT_SCRIPT,
      1,
      handoffKey(ref),
      accountId,
      identifier,
      LOGIN_HANDOFF_TTL_SECONDS,
    );
    return ref;
  }

  async redeem(ref: string): Promise<LoginHandoffEntry | null> {
    if (!isWellFormedHandoffReference(ref)) return null;
    const reply = await this.redis.eval(
      REDEEM_SCRIPT,
      1,
      handoffKey(ref),
      LOGIN_HANDOFF_MAX_REDEMPTIONS,
    );
    if (!Array.isArray(reply)) return null;
    const [accountId, identifier] = reply as unknown[];
    return typeof accountId === "string" && typeof identifier === "string"
      ? { accountId, identifier }
      : null;
  }
}

/**
 * In-memory {@link LoginHandoffStore} — the binding when no Redis is configured
 * (dev-stand / CI default, like the other Redis-backed stores) and the test
 * double. Same hashed key, TTL and redemption ceiling as the Redis adapter.
 */
export class InMemoryLoginHandoffStore implements LoginHandoffStore {
  private readonly entries = new Map<
    string,
    {
      accountId: string;
      identifier: string;
      redemptions: number;
      expiresAtMs: number;
    }
  >();

  constructor(private readonly now: () => number = () => Date.now()) {}

  mint(accountId: string, identifier: string): Promise<string> {
    const ref = newHandoffReference();
    this.entries.set(handoffKey(ref), {
      accountId,
      identifier,
      redemptions: 0,
      expiresAtMs: this.now() + LOGIN_HANDOFF_TTL_SECONDS * 1000,
    });
    return Promise.resolve(ref);
  }

  redeem(ref: string): Promise<LoginHandoffEntry | null> {
    if (!isWellFormedHandoffReference(ref)) return Promise.resolve(null);
    const key = handoffKey(ref);
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (this.now() >= entry.expiresAtMs) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    entry.redemptions += 1;
    return Promise.resolve(
      entry.redemptions > LOGIN_HANDOFF_MAX_REDEMPTIONS
        ? null
        : { accountId: entry.accountId, identifier: entry.identifier },
    );
  }

  /** Test seam: the stored keys (hashes only — the reference is never kept). */
  storedKeys(): string[] {
    return [...this.entries.keys()];
  }
}

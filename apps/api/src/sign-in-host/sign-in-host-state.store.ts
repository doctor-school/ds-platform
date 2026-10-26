import { createHash, randomBytes } from "node:crypto";
import type { SignInHostDoor, SignInHostStorefront } from "@ds/schemas";
import { openAtRest, sealAtRest } from "../common/crypto/at-rest.js";

/**
 * 003 EARS-66 / EARS-71, ADR-0015 §4 req. 3 — the sign-in host's short-lived
 * server-side state, in Redis with a TTL (in memory where no Redis is
 * configured, like the other Redis-backed auth stores):
 *
 * - **form state**, keyed by the form-state cookie: the CSRF token the form
 *   posts back, the storefront the auth request's `client_id` selected (the
 *   EARS-66 return target for a later stale request — never a URL parameter),
 *   the auth request this form answers, the entry intent spent for it, and the
 *   registration this browser created for it (the EARS-24/41 warm proof).
 * - **entry intents**, keyed by their opaque id (the authorize `login_hint`):
 *   `{door, method?, handoff?, eventTarget?, client_id}`, readable at most
 *   once. The writer is the storefront entry's transaction (EARS-71); it is
 *   deleted with that transaction.
 * - **storefront transactions** (003 EARS-61, ADR-0015 §4 step 1), keyed by
 *   their opaque id (the storefront's `__Host-ds_oidc_tx`): the `state`,
 *   `nonce` and PKCE verifier the API generated, the return path, the door,
 *   the kind and the bound intent id — the whole record an at-rest envelope,
 *   readable at most once (the callback's redeem takes it). A second key,
 *   `SHA-256(state)`, points at the transaction's key, so the callback can
 *   take it by the `state` it carries when the browser holds no (or another)
 *   transaction cookie (EARS-62); taking it either way removes both keys.
 *
 * Only `SHA-256(id)` ever reaches a key, and the hand-off reference is an
 * at-rest envelope (`common/crypto/at-rest.ts`), so a Redis dump carries no
 * usable cookie, intent id or reference.
 */
export const SIGN_IN_HOST_STATE_STORE = Symbol("SIGN_IN_HOST_STATE_STORE");

export interface EntryIntent {
  readonly door: SignInHostDoor;
  readonly method?: "password" | "code" | undefined;
  readonly eventTarget?: string | undefined;
  /** The Congress hand-off reference, plain in memory, sealed at rest. */
  readonly handoff?: string | undefined;
  readonly clientId: string;
}

/** 003 EARS-61 — one storefront transaction, held only by the API. */
export interface StorefrontTransaction {
  readonly client: SignInHostStorefront;
  readonly clientId: string;
  readonly kind: "interactive" | "silent";
  readonly door: SignInHostDoor;
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly returnPath?: string | undefined;
  /** 005 EARS-2 — the эфир slug whose registration the callback completes. */
  readonly completeRegistration?: string | undefined;
  /** The bound entry intent's id (EARS-71), deleted with the transaction. */
  readonly intentId?: string | undefined;
}

/**
 * 003 EARS-24/41 — the registration this form's browser just submitted on the
 * host: the account the registration CREATED, its address and the auth request
 * it answered. It is the host's proof that the code step runs in the same
 * browser as the registration (the warm step), standing in for the in-tab
 * password the host's full page loads cannot carry. Never a password.
 */
export interface FormRegistration {
  readonly sub: string;
  readonly email: string;
  readonly authRequestId: string;
  readonly createdAt: number;
}

export interface FormState {
  readonly csrfToken: string;
  readonly storefront: SignInHostStorefront;
  readonly authRequestId: string;
  readonly intent?: EntryIntent | undefined;
  /**
   * 003 EARS-44 (amended) — this form's auth request was opened by a hand-off
   * intent. A reload re-renders its code method without the reference, and a
   * live sign-in-host record never answers it, as on the first render.
   */
  readonly handoffSpent?: true | undefined;
  readonly registration?: FormRegistration | undefined;
}

export interface SignInHostStateStore {
  putForm(
    cookieId: string,
    state: FormState,
    ttlSeconds: number,
  ): Promise<void>;
  getForm(cookieId: string): Promise<FormState | null>;
  deleteForm(cookieId: string): Promise<void>;
  /** Store an intent for `ttlSeconds`; returns its fresh opaque id (32 random bytes). */
  putIntent(intent: EntryIntent, ttlSeconds: number): Promise<string>;
  /** Read and delete in one step: a second read of the same id is `null`. */
  takeIntent(id: string): Promise<EntryIntent | null>;
  /** Store a transaction for `ttlSeconds`; returns its fresh opaque id (32 random bytes). */
  putTransaction(
    tx: StorefrontTransaction,
    ttlSeconds: number,
  ): Promise<string>;
  /** Read and delete in one step (single use): a second read of the same id is `null`. */
  takeTransaction(id: string): Promise<StorefrontTransaction | null>;
  /**
   * 003 EARS-62 — take the transaction whose `state` this is (single use,
   * shared with {@link takeTransaction}: either take spends it for both).
   */
  takeTransactionByState(state: string): Promise<StorefrontTransaction | null>;
  /**
   * 003 EARS-12 / EARS-41 defence in depth — the moment every session of
   * `subject` was last revoked, kept for as long as any record can live; a
   * record whose credential step precedes it is refused even if its row
   * survived the delete (a concurrent write that raced the revocation).
   */
  markSubjectRevoked(
    subject: string,
    at: Date,
    ttlSeconds: number,
  ): Promise<void>;
  subjectRevokedAt(subject: string): Promise<Date | null>;
}

/** A fresh opaque id: 32 random bytes, base64url (≥128 random bits). */
export function newOpaqueId(): string {
  return randomBytes(32).toString("base64url");
}

const FORM_PREFIX = "sign-in-host:form:";
const INTENT_PREFIX = "sign-in-host:intent:";
const REVOKED_PREFIX = "sign-in-host:revoked:";
const TX_PREFIX = "sign-in-host:tx:";
const TX_STATE_PREFIX = "sign-in-host:tx-state:";

function parseInstant(raw: string | null): Date | null {
  if (raw === null) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
const hashed = (prefix: string, id: string): string =>
  `${prefix}${createHash("sha256").update(id).digest("hex")}`;

interface Serialised {
  door?: SignInHostDoor;
  method?: "password" | "code";
  eventTarget?: string;
  handoff?: string;
  clientId?: string;
}

/** The shared (de)serialisation: the hand-off reference never leaves sealed form. */
class StateCodec {
  constructor(private readonly key: Buffer) {}

  encodeIntent(intent: EntryIntent, context: string): Serialised {
    return {
      door: intent.door,
      ...(intent.method ? { method: intent.method } : {}),
      ...(intent.eventTarget ? { eventTarget: intent.eventTarget } : {}),
      ...(intent.handoff
        ? { handoff: sealAtRest(intent.handoff, this.key, context) }
        : {}),
      clientId: intent.clientId,
    };
  }

  decodeIntent(raw: Serialised, context: string): EntryIntent | null {
    if (!raw.door || !raw.clientId) return null;
    const handoff =
      raw.handoff === undefined
        ? undefined
        : (openAtRest(raw.handoff, this.key, context) ?? undefined);
    return {
      door: raw.door,
      method: raw.method,
      eventTarget: raw.eventTarget,
      handoff,
      clientId: raw.clientId,
    };
  }

  encodeTransaction(tx: StorefrontTransaction, context: string): string {
    return sealAtRest(JSON.stringify(tx), this.key, context);
  }

  decodeTransaction(
    raw: string,
    context: string,
  ): StorefrontTransaction | null {
    const plain = openAtRest(raw, this.key, context);
    if (!plain) return null;
    try {
      const tx = JSON.parse(plain) as Partial<StorefrontTransaction>;
      if (!tx.client || !tx.clientId || !tx.state || !tx.nonce || !tx.door)
        return null;
      return tx as StorefrontTransaction;
    } catch {
      return null;
    }
  }

  encodeForm(state: FormState, context: string): string {
    return JSON.stringify({
      csrfToken: state.csrfToken,
      storefront: state.storefront,
      authRequestId: state.authRequestId,
      ...(state.intent
        ? { intent: this.encodeIntent(state.intent, context) }
        : {}),
      ...(state.handoffSpent ? { handoffSpent: true } : {}),
      ...(state.registration ? { registration: state.registration } : {}),
    });
  }

  decodeForm(raw: string, context: string): FormState | null {
    try {
      const parsed = JSON.parse(raw) as {
        csrfToken?: string;
        storefront?: SignInHostStorefront;
        authRequestId?: string;
        intent?: Serialised;
        handoffSpent?: unknown;
        registration?: Partial<FormRegistration>;
      };
      if (!parsed.csrfToken || !parsed.storefront || !parsed.authRequestId)
        return null;
      const intent = parsed.intent
        ? this.decodeIntent(parsed.intent, context)
        : null;
      const r = parsed.registration;
      const registration =
        r &&
        typeof r.sub === "string" &&
        typeof r.email === "string" &&
        typeof r.authRequestId === "string" &&
        typeof r.createdAt === "number"
          ? {
              sub: r.sub,
              email: r.email,
              authRequestId: r.authRequestId,
              createdAt: r.createdAt,
            }
          : undefined;
      return {
        csrfToken: parsed.csrfToken,
        storefront: parsed.storefront,
        authRequestId: parsed.authRequestId,
        ...(intent ? { intent } : {}),
        ...(parsed.handoffSpent === true
          ? { handoffSpent: true as const }
          : {}),
        ...(registration ? { registration } : {}),
      };
    } catch {
      return null;
    }
  }
}

/** The slice of an ioredis client the store needs. */
export interface StateRedisLike {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const TAKE_SCRIPT =
  "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v";

export class RedisSignInHostStateStore implements SignInHostStateStore {
  private readonly codec: StateCodec;

  constructor(
    private readonly redis: StateRedisLike,
    key: Buffer,
  ) {
    this.codec = new StateCodec(key);
  }

  async putForm(cookieId: string, state: FormState, ttlSeconds: number) {
    const k = hashed(FORM_PREFIX, cookieId);
    await this.redis.set(k, this.codec.encodeForm(state, k), "EX", ttlSeconds);
  }

  async getForm(cookieId: string): Promise<FormState | null> {
    const k = hashed(FORM_PREFIX, cookieId);
    const raw = await this.redis.get(k);
    return raw ? this.codec.decodeForm(raw, k) : null;
  }

  async deleteForm(cookieId: string): Promise<void> {
    await this.redis.del(hashed(FORM_PREFIX, cookieId));
  }

  async putIntent(intent: EntryIntent, ttlSeconds: number): Promise<string> {
    const id = newOpaqueId();
    const k = hashed(INTENT_PREFIX, id);
    await this.redis.set(
      k,
      JSON.stringify(this.codec.encodeIntent(intent, k)),
      "EX",
      ttlSeconds,
    );
    return id;
  }

  async takeIntent(id: string): Promise<EntryIntent | null> {
    const k = hashed(INTENT_PREFIX, id);
    const raw = await this.redis.eval(TAKE_SCRIPT, 1, k);
    if (typeof raw !== "string") return null;
    try {
      return this.codec.decodeIntent(JSON.parse(raw) as Serialised, k);
    } catch {
      return null;
    }
  }

  async putTransaction(
    tx: StorefrontTransaction,
    ttlSeconds: number,
  ): Promise<string> {
    const id = newOpaqueId();
    const k = hashed(TX_PREFIX, id);
    await this.redis.set(
      k,
      this.codec.encodeTransaction(tx, k),
      "EX",
      ttlSeconds,
    );
    // The index holds the transaction's key (a hash), never its id.
    await this.redis.set(
      hashed(TX_STATE_PREFIX, tx.state),
      k,
      "EX",
      ttlSeconds,
    );
    return id;
  }

  async takeTransaction(id: string): Promise<StorefrontTransaction | null> {
    const tx = await this.takeAt(hashed(TX_PREFIX, id));
    if (tx) await this.redis.del(hashed(TX_STATE_PREFIX, tx.state));
    return tx;
  }

  async takeTransactionByState(
    state: string,
  ): Promise<StorefrontTransaction | null> {
    const k = await this.redis.eval(
      TAKE_SCRIPT,
      1,
      hashed(TX_STATE_PREFIX, state),
    );
    if (typeof k !== "string" || !k.startsWith(TX_PREFIX)) return null;
    const tx = await this.takeAt(k);
    // A pointer whose transaction carries another state is not this one's.
    return tx && tx.state === state ? tx : null;
  }

  private async takeAt(k: string): Promise<StorefrontTransaction | null> {
    const raw = await this.redis.eval(TAKE_SCRIPT, 1, k);
    return typeof raw === "string"
      ? this.codec.decodeTransaction(raw, k)
      : null;
  }

  async markSubjectRevoked(subject: string, at: Date, ttlSeconds: number) {
    await this.redis.set(
      hashed(REVOKED_PREFIX, subject),
      String(at.getTime()),
      "EX",
      ttlSeconds,
    );
  }

  async subjectRevokedAt(subject: string): Promise<Date | null> {
    return parseInstant(await this.redis.get(hashed(REVOKED_PREFIX, subject)));
  }
}

/** In-memory binding (dev-stand without Redis, CI, unit specs); same contract. */
export class InMemorySignInHostStateStore implements SignInHostStateStore {
  private readonly codec: StateCodec;
  private readonly entries = new Map<
    string,
    { value: string; until: number }
  >();

  constructor(
    key: Buffer,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.codec = new StateCodec(key);
  }

  private read(k: string): string | null {
    const entry = this.entries.get(k);
    if (!entry) return null;
    if (this.now() >= entry.until) {
      this.entries.delete(k);
      return null;
    }
    return entry.value;
  }

  private write(k: string, value: string, ttlSeconds: number): void {
    this.entries.set(k, { value, until: this.now() + ttlSeconds * 1000 });
  }

  putForm(cookieId: string, state: FormState, ttlSeconds: number) {
    const k = hashed(FORM_PREFIX, cookieId);
    this.write(k, this.codec.encodeForm(state, k), ttlSeconds);
    return Promise.resolve();
  }

  getForm(cookieId: string): Promise<FormState | null> {
    const k = hashed(FORM_PREFIX, cookieId);
    const raw = this.read(k);
    return Promise.resolve(raw ? this.codec.decodeForm(raw, k) : null);
  }

  deleteForm(cookieId: string): Promise<void> {
    this.entries.delete(hashed(FORM_PREFIX, cookieId));
    return Promise.resolve();
  }

  putIntent(intent: EntryIntent, ttlSeconds: number): Promise<string> {
    const id = newOpaqueId();
    const k = hashed(INTENT_PREFIX, id);
    this.write(
      k,
      JSON.stringify(this.codec.encodeIntent(intent, k)),
      ttlSeconds,
    );
    return Promise.resolve(id);
  }

  takeIntent(id: string): Promise<EntryIntent | null> {
    const k = hashed(INTENT_PREFIX, id);
    const raw = this.read(k);
    this.entries.delete(k);
    if (!raw) return Promise.resolve(null);
    try {
      return Promise.resolve(
        this.codec.decodeIntent(JSON.parse(raw) as Serialised, k),
      );
    } catch {
      return Promise.resolve(null);
    }
  }

  putTransaction(
    tx: StorefrontTransaction,
    ttlSeconds: number,
  ): Promise<string> {
    const id = newOpaqueId();
    const k = hashed(TX_PREFIX, id);
    this.write(k, this.codec.encodeTransaction(tx, k), ttlSeconds);
    this.write(hashed(TX_STATE_PREFIX, tx.state), k, ttlSeconds);
    return Promise.resolve(id);
  }

  takeTransaction(id: string): Promise<StorefrontTransaction | null> {
    const tx = this.takeAt(hashed(TX_PREFIX, id));
    if (tx) this.entries.delete(hashed(TX_STATE_PREFIX, tx.state));
    return Promise.resolve(tx);
  }

  takeTransactionByState(state: string): Promise<StorefrontTransaction | null> {
    const pointer = hashed(TX_STATE_PREFIX, state);
    const k = this.read(pointer);
    this.entries.delete(pointer);
    if (!k?.startsWith(TX_PREFIX)) return Promise.resolve(null);
    const tx = this.takeAt(k);
    return Promise.resolve(tx && tx.state === state ? tx : null);
  }

  private takeAt(k: string): StorefrontTransaction | null {
    const raw = this.read(k);
    this.entries.delete(k);
    return raw ? this.codec.decodeTransaction(raw, k) : null;
  }

  markSubjectRevoked(subject: string, at: Date, ttlSeconds: number) {
    this.write(
      hashed(REVOKED_PREFIX, subject),
      String(at.getTime()),
      ttlSeconds,
    );
    return Promise.resolve();
  }

  subjectRevokedAt(subject: string): Promise<Date | null> {
    return Promise.resolve(
      parseInstant(this.read(hashed(REVOKED_PREFIX, subject))),
    );
  }

  /** Test seam: every stored value, to prove no plain reference is kept. */
  storedValues(): string[] {
    return [...this.entries.values()].map((e) => e.value);
  }
}

/**
 * EARS-71 — resolve the entry intent named by an auth request's `login_hint`:
 * at most once (the read spends it, whatever the outcome), and only for an auth
 * request whose `client_id` equals the intent's. Unknown, spent, expired or
 * foreign ⇒ `undefined`: the door's plain form, no card, no error.
 */
export async function resolveEntryIntent(
  store: SignInHostStateStore,
  loginHint: string | undefined,
  clientId: string,
): Promise<EntryIntent | undefined> {
  if (!loginHint || !/^[A-Za-z0-9_-]{43}$/.test(loginHint)) return undefined;
  const intent = await store.takeIntent(loginHint);
  if (!intent || intent.clientId !== clientId) return undefined;
  return intent;
}

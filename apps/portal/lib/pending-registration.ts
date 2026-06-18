"use client";

/**
 * In-memory hand-off of the in-flight registration credential (#175).
 *
 * `/register` collects an identifier + password and routes to `/verify`; on a
 * successful verify we want to replay the REAL EARS-5 password login so the
 * freshly-registered user lands signed-in on `/account` without re-typing their
 * credentials. The password must therefore survive the `/register → /verify`
 * client navigation — but ONLY that, and ONLY in volatile memory.
 *
 * This is a deliberate, security-shaped choice (issue #175 envelope). The held
 * password is:
 *   • held in module memory for the **in-flight registration only** — module-level
 *     state lives for the lifetime of the JS bundle in the tab, and a client-side
 *     `router.push`/`replace` (SPA nav) does NOT re-evaluate the module, so the
 *     held credential survives the `/register → /verify` navigation;
 *   • NEVER written to the URL, `localStorage`, `sessionStorage`, a cookie,
 *     IndexedDB, or any persisted store — it lives in the single module-scoped
 *     slot below and nowhere else (only the non-secret identifier rides the
 *     `/verify` query);
 *   • atomically **consumed-and-wiped on verify success** — see
 *     {@link takePendingRegistration}, which wipes the slot whether the replay
 *     login then succeeds or throws;
 *   • **self-expiring after {@link PENDING_TTL_MS}** — a record older than the TTL
 *     is treated as no-hold and dropped, deterministically bounding how long the
 *     password can linger after an abandoned `/verify` (this is the abandonment
 *     guarantee; see below for why it is NOT an unmount-cleanup);
 *   • **overwritten by a new registration** — the slot is single-valued, so a
 *     fresh `/register` submit replaces any prior held password;
 *   • **dropped on a hard reload** — re-loading the bundle (hard reload, fresh
 *     tab, or deep link to `/verify`) clears the slot, which is the desired
 *     property: the user then falls back to the `/login` round-trip.
 *
 * Why a TTL and not a `/verify`-unmount cleanup for abandonment: the password is
 * stashed by `/register` BEFORE navigating to `/verify`, so a `useEffect` cleanup
 * on the `/verify` mount would — under React Strict Mode in `next dev`, which
 * double-invokes effects (setup → cleanup → setup) — wipe the slot before the
 * user types the code, breaking the auto-login. The TTL bound is immune to that:
 * it never clears on mount, only on age.
 *
 * A React context is intentionally NOT used: the provider would unmount across
 * the `/register → /verify` route change and drop the value. A module singleton
 * is the right lifetime here.
 */

export interface PendingRegistration {
  /** The email the user registered with (also echoed in the URL — not secret). Registration is email-only (#202). */
  readonly identifier: string;
  /** The plaintext password, held in memory ONLY for the in-flight replay. */
  readonly password: string;
}

/** The held record plus its expiry stamp (internal — the TTL is not part of the public shape). */
interface HeldRegistration extends PendingRegistration {
  /** Epoch ms after which the record is stale and must be treated as no-hold. */
  readonly expiresAt: number;
}

/**
 * How long a held password may linger before it self-expires. The verify step
 * runs seconds after register (the user types a code that just arrived), so a
 * few minutes is a generous in-flight window while still deterministically
 * bounding the lingering-credential exposure after an abandoned `/verify`.
 */
export const PENDING_TTL_MS = 5 * 60_000;

/** The single in-memory slot. Module-scoped — survives SPA nav, not a reload. */
let pending: HeldRegistration | null = null;

/**
 * Stash the in-flight registration credential right before navigating to
 * `/verify`. Overwrites any prior held record (single slot) and stamps it with a
 * {@link PENDING_TTL_MS} expiry so an abandoned hold cannot linger indefinitely.
 */
export function setPendingRegistration(value: PendingRegistration): void {
  pending = { ...value, expiresAt: Date.now() + PENDING_TTL_MS };
}

/**
 * Consume the held credential for a given identifier, clearing it atomically.
 *
 * Returns the held registration only when it has NOT expired AND its identifier
 * matches the one being verified (guards a stale hand-off from a different
 * attempt). The slot is ALWAYS wiped — so the caller can replay the login and the
 * password is gone whether the replay then succeeds or throws, and an expired
 * record is dropped here too (callers see `null` → the `/login` fallback).
 */
export function takePendingRegistration(
  identifier: string,
): PendingRegistration | null {
  const held = pending;
  pending = null;
  if (!held || held.expiresAt <= Date.now()) return null;
  if (held.identifier !== identifier) return null;
  const { expiresAt: _expiresAt, ...registration } = held;
  return registration;
}

/**
 * Read the held credential for an identifier WITHOUT consuming it — used by the
 * #237 register-verify resend, which must re-issue the verification email (re-POST
 * `/register`) while leaving the held password in place for the eventual
 * verify-success auto-login replay. Returns `null` when the slot is empty, expired,
 * or held for a different identifier (same guards as {@link takePendingRegistration},
 * minus the wipe). NEVER mutates the slot.
 */
export function peekPendingRegistration(
  identifier: string,
): PendingRegistration | null {
  const held = pending;
  if (!held || held.expiresAt <= Date.now()) return null;
  if (held.identifier !== identifier) return null;
  const { expiresAt: _expiresAt, ...registration } = held;
  return registration;
}

/** Drop any held credential (abandonment / explicit reset). */
export function clearPendingRegistration(): void {
  pending = null;
}

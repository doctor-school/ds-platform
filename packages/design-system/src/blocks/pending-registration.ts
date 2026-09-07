"use client";

/**
 * In-memory hand-off of the in-flight registration credential (#175, #1996).
 *
 * The ONE canonical post-confirmation sign-in mechanism BOTH storefronts run.
 * A registration surface collects an identifier + password and then confirms the
 * email; on a successful confirm we replay the REAL 003 EARS-5 password login so
 * the freshly-registered user is signed in without re-typing their credentials.
 * The password must therefore survive the step between register and confirm —
 * but ONLY that, and ONLY in volatile memory.
 *
 * The two projections of the same contract (021 boundary table: «a second
 * rendition of the same contract, not a fork»):
 *   • Academy — `apps/portal/app/register/page.tsx` holds before the client
 *     navigation to `/verify`, `apps/portal/app/verify/page.tsx` consumes it
 *     after `authClient.verify` succeeds;
 *   • doctor storefront — `apps/doctor/components/registration-screen.tsx`
 *     holds after `registerDoctor` succeeded and consumes it after
 *     `confirmDoctorEmail` succeeded (021 EARS-15: a registered doctor is never
 *     asked to register again). That host renders register + confirm in ONE
 *     component with no route change, so the hold spans a state change rather
 *     than a navigation — the same module lifetime either way.
 *
 * This is a deliberate, security-shaped choice (003 EARS-39 envelope, issue
 * #175). The held password is:
 *   • held in module memory for the **in-flight registration only** — module-level
 *     state lives for the lifetime of the JS bundle in the tab, and neither a
 *     client-side `router.push`/`replace` (SPA nav, the Academy) nor a local
 *     state change (the doctor host's single-component screen) re-evaluates the
 *     module, so the held credential survives the step to the confirm surface;
 *   • NEVER written to the URL, `localStorage`, `sessionStorage`, a cookie,
 *     IndexedDB, or any persisted store — it lives in the single module-scoped
 *     slot below and nowhere else (only the non-secret identifier rides the
 *     `/verify` query);
 *   • atomically **consumed-and-wiped on confirm success** — see
 *     {@link takePendingRegistration}, which wipes the slot whether the replay
 *     login then succeeds or throws;
 *   • **self-expiring after {@link PENDING_TTL_MS}** — a record older than the TTL
 *     is treated as no-hold and dropped, deterministically bounding how long the
 *     password can linger after an abandoned confirm step (this is the abandonment
 *     guarantee; see below for why it is NOT an unmount-cleanup);
 *   • **overwritten by a new registration** — the slot is single-valued, so a
 *     fresh register submit replaces any prior held password;
 *   • **dropped on a hard reload** — re-loading the bundle (hard reload, fresh
 *     tab, or a deep link to the confirm surface) clears the slot, which is the
 *     desired property and NOT a dead end: the Academy falls back to the
 *     `/login` round-trip, and the doctor host's reload lands on the empty
 *     register form, where re-registering answers with the identical 003 EARS-16
 *     response and refills the slot on the way to the code step.
 *
 * Why a TTL and not an unmount cleanup for abandonment: the password is stashed
 * BEFORE the confirm surface exists, so a `useEffect` cleanup on its mount would
 * — under React Strict Mode in `next dev`, which double-invokes effects (setup →
 * cleanup → setup) — wipe the slot before the
 * user types the code, breaking the auto-login. The TTL bound is immune to that:
 * it never clears on mount, only on age.
 *
 * A React context is intentionally NOT used: on the Academy the provider would
 * unmount across the `/register → /verify` route change and drop the value. A
 * module singleton is the right lifetime here, and it is what lets the two hosts
 * share ONE implementation instead of two hand-rolled ones (ADR-0013 A1).
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
 * runs seconds after the register submit (the user types a code that just
 * arrived), so a
 * few minutes is a generous in-flight window while still deterministically
 * bounding the lingering-credential exposure after an abandoned confirm step.
 */
export const PENDING_TTL_MS = 5 * 60_000;

/** The single in-memory slot. Module-scoped — survives SPA nav, not a reload. */
let pending: HeldRegistration | null = null;

/**
 * Stash the in-flight registration credential right after the register command
 * succeeded and before the confirm surface takes over. Overwrites any prior held
 * record (single slot) and stamps it with a {@link PENDING_TTL_MS} expiry so an
 * abandoned hold cannot linger indefinitely.
 */
export function setPendingRegistration(value: PendingRegistration): void {
  pending = { ...value, expiresAt: Date.now() + PENDING_TTL_MS };
}

/**
 * Consume the held credential for a given identifier, clearing it atomically.
 *
 * Returns the held registration only when it has NOT expired AND its identifier
 * matches the one being confirmed (guards a stale hand-off from a different
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

/** Drop any held credential (abandonment / explicit reset). */
export function clearPendingRegistration(): void {
  pending = null;
}

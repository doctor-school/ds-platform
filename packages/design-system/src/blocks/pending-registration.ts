"use client";

import type { RegisterCardValues } from "./register-card";

/**
 * In-memory hold of the in-flight registration values (003 EARS-39 amended,
 * EARS-41; #2556).
 *
 * The ONE mechanism BOTH storefronts run between the registration form and its
 * code step. The registration command answers `pending_verification` for a new
 * and an already-registered address alike (003 EARS-16), and nothing is written
 * to an existing account before its code is accepted (EARS-23 amended) — so the
 * password and consent the visitor typed must reach the server WITH the code:
 * the code step submits them as the verify request's `registration`, and the
 * server establishes the session itself. There is no password replay.
 *
 * The held values are:
 *   • held in module memory for the **in-flight registration only** — module
 *     state lives for the lifetime of the JS bundle in the tab, and a
 *     client-side `router.push` (`/register` → `/verify` and back) does not
 *     re-evaluate the module;
 *   • NEVER written to the URL, `localStorage`, `sessionStorage`, a cookie,
 *     IndexedDB, or any persisted store (only the non-secret address rides the
 *     `/verify` query);
 *   • **kept across a refused code** — {@link peekPendingRegistration} reads
 *     without wiping, so a mistyped code is retried with the same values; the
 *     code step wipes the slot once the code is accepted;
 *   • the source of **«← Изменить почту»** — the registration form refills from
 *     `form`, so the visitor returns to the fields they typed (003 EARS-24);
 *   • **self-expiring after {@link PENDING_TTL_MS}** and **dropped on a hard
 *     reload** — a cold step then submits the code alone, and the account's
 *     pre-verification password is invalidated (003 EARS-39 amended / EARS-41);
 *   • **overwritten by a new registration** — the slot is single-valued.
 *
 * Why a TTL and not an unmount cleanup: the values are stashed BEFORE the code
 * step exists, so a mount effect's cleanup — double-invoked under React Strict
 * Mode — would wipe the slot before the visitor types the code.
 *
 * A React context is intentionally NOT used: the provider would unmount across
 * the `/register → /verify` route change and drop the value. A module singleton
 * is the right lifetime, and lets both hosts share ONE implementation (ADR-0013 A1).
 */

/** One recorded consent acceptance as the registration command carried it. */
export interface PendingConsentAcceptance {
  readonly purpose: string;
  readonly version: string;
}

/** The verify request's `registration` — what the code step submits with the code. */
export interface PendingRegistrationValues {
  readonly password: string;
  readonly consent: readonly PendingConsentAcceptance[];
  /** 021 EARS-4 — present only where the host states the declaration. */
  readonly medicalWorkerDeclaration?: true;
}

export interface PendingRegistration {
  /** The email the user registered with (also in the URL — not secret). */
  readonly identifier: string;
  /** What the code step submits as `registration`. */
  readonly registration: PendingRegistrationValues;
  /** The typed form, for «← Изменить почту» to refill. */
  readonly form: RegisterCardValues;
}

/** The held record plus its expiry stamp (internal). */
interface HeldRegistration extends PendingRegistration {
  readonly expiresAt: number;
}

/**
 * How long the values may linger before they self-expire — a generous window
 * for a code that just arrived, still bounding an abandoned step.
 */
export const PENDING_TTL_MS = 5 * 60_000;

/** The single in-memory slot. Module-scoped — survives SPA nav, not a reload. */
let pending: HeldRegistration | null = null;

/** Stash the values right after the register command succeeded. Overwrites any prior hold. */
export function setPendingRegistration(value: PendingRegistration): void {
  pending = { ...value, expiresAt: Date.now() + PENDING_TTL_MS };
}

/**
 * Read the held values WITHOUT wiping them. With an `identifier`, a hold for a
 * different address is no hold (a stale hand-off from another attempt). An
 * expired record is dropped here.
 */
export function peekPendingRegistration(
  identifier?: string,
): PendingRegistration | null {
  const held = pending;
  if (!held) return null;
  if (held.expiresAt <= Date.now()) {
    pending = null;
    return null;
  }
  if (identifier !== undefined && held.identifier !== identifier) return null;
  const { expiresAt: _expiresAt, ...registration } = held;
  return registration;
}

/** Drop any held values (accepted code / abandonment / explicit reset). */
export function clearPendingRegistration(): void {
  pending = null;
}

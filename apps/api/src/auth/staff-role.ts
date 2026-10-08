import { users } from "@ds/db";
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { DOCTOR_GUEST_ROLE } from "./idp/idp.types.js";

/**
 * #2456 — staff accounts are users too.
 *
 * A staff member holds the visitor role (`doctor_guest`) AND a staff role on
 * top (admin onboarding runbook, step 5), so the storefronts serve them like any
 * signed-in visitor: a profile, a sign-out, their own events. What they are NOT
 * is a participant — a staff account must never inflate the «сколько коллег
 * записалось» figure, the congress roster, or the in-room population.
 *
 * The marker is the `users.role` mirror column: the IdP project-roles claim is
 * the authority (ADR-0001), and {@link mirrorRoleFromClaims} projects it onto
 * the mirror on every authenticated request (`MirrorSelfHealService`). Any staff
 * role present ⇒ that staff role; otherwise the visitor role.
 */

/**
 * Staff roles in precedence order — the FIRST one the claim carries is the one
 * the mirror records. Enumerated rather than «anything but doctor_guest», so a
 * future visitor tier (`doctor`, `expert`) is a deliberate edit here and never
 * silently turns a doctor into staff.
 */
export const STAFF_ROLES = [
  "platform_admin",
  "event-registrar",
  "congress-program-committee",
  "legacy_admin",
  "pd_officer",
] as const;

/** The only `users.role` value that counts as a participant. */
export const PARTICIPANT_ROLE = DOCTOR_GUEST_ROLE;

/**
 * The `users.role` value the session's project-roles claim projects onto: the
 * highest-precedence staff role it carries, else the visitor role.
 */
export function mirrorRoleFromClaims(roles: readonly string[]): string {
  const held = new Set(roles);
  return STAFF_ROLES.find((role) => held.has(role)) ?? PARTICIPANT_ROLE;
}

/**
 * SQL predicate: the account behind `userIdColumn` is a participant (its mirror
 * row carries the visitor role, not a staff role). One `EXISTS` over `users`, so
 * it composes into any participant count/list without changing the query's
 * join shape (inside the subquery `users` resolves to the inner table even when
 * the outer query already joins `users`).
 */
export function isParticipant(userIdColumn: AnyColumn): SQL {
  return sql`exists (
    select 1 from ${users}
     where ${users.id} = ${userIdColumn}
       and ${users.role} = ${PARTICIPANT_ROLE}
  )`;
}

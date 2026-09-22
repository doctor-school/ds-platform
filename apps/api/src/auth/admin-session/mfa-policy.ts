import type { Role } from "../../authz/authz.types.js";

/**
 * EARS-3 — the `role → mfa_required` policy, populated with its first tenant.
 *
 * 003 shipped this as a **documented no-op seam** (`003-design.md` §Seams: _"a
 * `role → mfa_required` policy check sits (as a no-op for v1 self-serve roles)
 * right after the primary-auth step"_) with no elevated roles in it. 011 is the
 * first vertical with a mandatory-MFA role, so the seam gets its first entry:
 * `platform_admin` (ADR-0001 §4 fixes TOTP as its factor).
 *
 * **It stays a map on purpose.** Adding `moderator` / `expert` / `clinic_admin`
 * later must be a data change, not a reshape (011 Scope → Out names each as a
 * future tenant whose factor kind differs per ADR-0001 §4). The mandate lives
 * here, in `apps/api`, and NOT as an org-wide Zitadel `forceMfa` switch: Zitadel
 * login policies are organisation-scoped, so an IdP-side mandate would impose
 * TOTP on every `doctor_guest` (011 Constraints, design §7).
 *
 * 044 EARS-19 adds the second tenant, `event-registrar`, and it is exactly the
 * data change this shape was kept for. The registrar works inside `apps/admin`,
 * and the admin origin admits a principal ONLY through this map
 * (`admin-session.service.ts` `startLogin` refuses a role it does not cover —
 * «the admin origin is not a general login surface»). So the alternative to an
 * entry here would have been a second, weaker door into the admin tier, which is
 * the one thing 011 exists to prevent. Its factor is TOTP, like
 * `platform_admin`'s (ADR-0001 §4): the registrar enrols on first login and is
 * challenged afterwards, on the same flow, with no branch. Holding the role grants
 * a SESSION, not reach — what a registrar may then do is the per-route `@Authz`
 * classification of EARS-19, and it is the roster route and the session reads.
 */
export const MFA_REQUIRED_BY_ROLE: Readonly<Partial<Record<Role, true>>> =
  Object.freeze({
    platform_admin: true,
    "event-registrar": true,
  });

/**
 * EARS-3: does any role this principal holds require a second factor? Evaluated
 * **immediately after** primary authentication — a principal that answers `true`
 * never receives a session on primary auth alone; it receives a pending-auth
 * reference plus the required next step.
 */
export function requiresMfa(roles: readonly string[]): boolean {
  return roles.some((role) => MFA_REQUIRED_BY_ROLE[role as Role] === true);
}

/** The roles currently in the policy — the reviewable list, for tests and docs. */
export function mfaRequiredRoles(): Role[] {
  return Object.keys(MFA_REQUIRED_BY_ROLE) as Role[];
}

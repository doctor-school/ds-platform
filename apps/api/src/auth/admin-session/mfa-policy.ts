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
 */
export const MFA_REQUIRED_BY_ROLE: Readonly<Partial<Record<Role, true>>> =
  Object.freeze({
    platform_admin: true,
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

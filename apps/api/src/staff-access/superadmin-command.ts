import {
  DOCTOR_GUEST_ROLE,
  IdpAmbiguousEmailError,
  IdpUnavailableError,
  type IdpClient,
} from "../auth/idp/idp.types.js";
import type { AdminSessionService } from "../auth/admin-session/admin-session.service.js";
import { mirrorRoleFromClaims } from "../auth/staff-role.js";
import type { StaffAccessRepository } from "./staff-access.repository.js";

/**
 * 049 EARS-6 — the superadmin operator command's write half: the only path that
 * gives and removes `superadmin` (049-design §Operator command). «Доступы»
 * never grants or revokes it.
 *
 * It writes through the staff-access pieces, not around them: the same IdP
 * adapter calls (find by email, read grant, `PUT` grant), the same `users`
 * mirror and ledger writer ({@link StaffAccessRepository.commitGrant} /
 * {@link StaffAccessRepository.commitRevocation}) and the same session ending
 * ({@link AdminSessionService.endAllAdminAccess}), so its `auth.role.granted` /
 * `auth.role.revoked` rows are shape-identical to a «Доступы» row, with
 * `by_admin` = the operator subject passed.
 *
 * A separate module rather than a `StaffAccessService` method, so the
 * «Доступы» endpoints and this command evolve without touching each other.
 */

export const SUPERADMIN_ROLE = "superadmin";
export const PLATFORM_ADMIN_ROLE = "platform_admin";

export type SuperadminVerb = "grant" | "remove";

export interface SuperadminCommand {
  verb: SuperadminVerb;
  /** Email of the existing account the command acts on. */
  email: string;
  /** IdP subject of the operator — the ledger rows' `by_admin` actor. */
  byAdmin: string;
}

/** What the command did — no secret ever travels in it. */
export interface SuperadminCommandResult {
  verb: SuperadminVerb;
  sub: string;
  /** Roles added (grant) or removed (remove) by this run; empty on a repeat. */
  changed: string[];
  byAdmin: string;
}

export type SuperadminRefusalCode =
  | "BY_ADMIN_UNKNOWN"
  | "EMAIL_UNKNOWN"
  | "EMAIL_UNVERIFIED"
  | "EMAIL_AMBIGUOUS"
  | "NOT_A_SUPERADMIN"
  | "LAST_SUPERADMIN";

const REASONS: Record<SuperadminRefusalCode, string> = {
  BY_ADMIN_UNKNOWN:
    "the --by-admin subject is missing or resolves to no IdP account",
  EMAIL_UNKNOWN: "no account holds this email",
  EMAIL_UNVERIFIED: "the email of this account is not verified",
  EMAIL_AMBIGUOUS: "more than one account holds this email",
  NOT_A_SUPERADMIN: "the account does not hold superadmin",
  LAST_SUPERADMIN:
    "the account is the last holder of superadmin; grant it to another account first",
};

/** A refusal answered before any write: nothing was changed. */
export class SuperadminRefusal extends Error {
  constructor(readonly code: SuperadminRefusalCode) {
    super(`${code}: ${REASONS[code]}`);
    this.name = "SuperadminRefusal";
  }
}

/** The collaborators the command writes through. */
export interface SuperadminCommandDeps {
  idp: IdpClient;
  repo: StaffAccessRepository;
  adminSessions: Pick<AdminSessionService, "endAllAdminAccess">;
}

/** Run one `grant` or `remove`. Every refusal comes before any write. */
export async function applySuperadminCommand(
  deps: SuperadminCommandDeps,
  command: SuperadminCommand,
): Promise<SuperadminCommandResult> {
  await assertOperatorExists(deps.idp, command.byAdmin);
  return command.verb === "grant"
    ? deps.repo.withGrantLock(command.email, () => grantLocked(deps, command))
    : removeSuperadmin(deps, command);
}

/**
 * `--by-admin` must name an existing IdP account; its roles are not checked
 * (the first holder names their own subject, as a break-glass run does).
 */
async function assertOperatorExists(
  idp: IdpClient,
  byAdmin: string,
): Promise<void> {
  if (byAdmin.trim() === "" || !(await idp.getUser(byAdmin))) {
    throw new SuperadminRefusal("BY_ADMIN_UNKNOWN");
  }
}

/** The one existing, verified account holding `email` (047 EARS-3 rules). */
async function verifiedSubOf(idp: IdpClient, email: string): Promise<string> {
  let sub: string | null;
  try {
    sub = await idp.findUserByEmail(email);
  } catch (error) {
    if (error instanceof IdpAmbiguousEmailError) {
      throw new SuperadminRefusal("EMAIL_AMBIGUOUS");
    }
    throw error;
  }
  if (!sub) throw new SuperadminRefusal("EMAIL_UNKNOWN");
  const user = await idp.getUser(sub);
  // A `null` read of an account the email lookup just named is a provider
  // fault, not «unverified»: fail loud rather than refuse on a guess.
  if (!user) {
    throw new IdpUnavailableError("the IdP did not return the account");
  }
  if (!user.emailVerified) throw new SuperadminRefusal("EMAIL_UNVERIFIED");
  return sub;
}

/**
 * grant — add `superadmin` and `platform_admin` to the existing grant, each
 * only when absent, keeping every other role; one `auth.role.granted` per role
 * added, written after the IdP holds it. A repeat finds both present and writes
 * nothing. A held `superadmin` with no grant mark of its own (a run that failed
 * after its IdP write) gets the mark, so a retry closes the ledger.
 */
async function grantLocked(
  { idp, repo }: SuperadminCommandDeps,
  { email, byAdmin }: SuperadminCommand,
): Promise<SuperadminCommandResult> {
  const sub = await verifiedSubOf(idp, email);
  const grant = await idp.getProjectGrant(sub);
  const held = grant?.roleKeys ?? [];
  const added = [PLATFORM_ADMIN_ROLE, SUPERADMIN_ROLE].filter(
    (role) => !held.includes(role),
  );

  const roleKeys = [...held, ...added];
  if (!grant) {
    await idp.grantProjectRole(sub, [DOCTOR_GUEST_ROLE, ...added]);
    roleKeys.unshift(DOCTOR_GUEST_ROLE);
  } else if (added.length > 0) {
    await idp.updateProjectGrantRoles(sub, grant.grantId, roleKeys);
  }

  const toMark = [...added];
  if (
    !added.includes(SUPERADMIN_ROLE) &&
    (await repo.latestRoleEvent(sub, SUPERADMIN_ROLE, null)) !==
      "auth.role.granted"
  ) {
    toMark.push(SUPERADMIN_ROLE);
  }

  const mirror = await repo.findMirrorBySub(sub);
  // `platform_admin` first, so the `superadmin` mark — the run's completion
  // mark — is the last row written.
  for (const role of toMark) {
    await repo.commitGrant({
      sub,
      email: mirror?.email ?? email,
      fullName: mirror?.displayName ?? null,
      mirrorRole: mirrorRoleFromClaims(roleKeys),
      role,
      eventId: null,
      byAdmin,
    });
  }
  return { verb: "grant", sub, changed: added, byAdmin };
}

/**
 * remove — refuse the last holder; remove `superadmin` only (`platform_admin`
 * stays), end every admin session and pending sign-in — also when the IdP
 * write failed — and append `auth.role.revoked`. A held-nothing account whose
 * latest mark is the revocation's own is refused as not a superadmin; one with
 * a grant mark left over (a removal that failed after its IdP step) is
 * finished by the repeat.
 */
async function removeSuperadmin(
  deps: SuperadminCommandDeps,
  command: SuperadminCommand,
): Promise<SuperadminCommandResult> {
  const sub = await verifiedSubOf(deps.idp, command.email);
  return deps.repo.withRevokeLock(sub, () =>
    removeLocked(deps, sub, command.byAdmin),
  );
}

async function removeLocked(
  { idp, repo, adminSessions }: SuperadminCommandDeps,
  sub: string,
  byAdmin: string,
): Promise<SuperadminCommandResult> {
  const grant = await idp.getProjectGrant(sub);
  const holds = grant?.roleKeys.includes(SUPERADMIN_ROLE) ?? false;

  if (!holds) {
    const latest = await repo.latestRoleEvent(sub, SUPERADMIN_ROLE, null);
    if (latest !== "auth.role.granted") {
      throw new SuperadminRefusal("NOT_A_SUPERADMIN");
    }
  } else {
    const holders = await idp.listProjectGrantsWithRoles([SUPERADMIN_ROLE]);
    const others = holders.filter(
      (h) => h.sub !== sub && h.roleKeys.includes(SUPERADMIN_ROLE),
    );
    if (others.length === 0) throw new SuperadminRefusal("LAST_SUPERADMIN");
  }

  const remaining = (grant?.roleKeys ?? []).filter(
    (key) => key !== SUPERADMIN_ROLE,
  );
  let failure: unknown;
  try {
    if (holds && remaining.length === 0) {
      // A grant is never written with no roles (047 revoke cascade step 3).
      await idp.removeProjectGrant(sub, grant!.grantId);
    } else if (holds) {
      await idp.updateProjectGrantRoles(sub, grant!.grantId, remaining);
    }
  } catch (error) {
    failure = error;
  }

  // Sessions — always (047-design: fail-safe on an IdP failure).
  await adminSessions.endAllAdminAccess(sub);
  if (failure !== undefined) throw failure;

  await repo.commitRevocation({
    sub,
    mirrorRole: mirrorRoleFromClaims(remaining),
    role: SUPERADMIN_ROLE,
    eventId: null,
    byAdmin,
  });
  return {
    verb: "remove",
    sub,
    changed: holds ? [SUPERADMIN_ROLE] : [],
    byAdmin,
  };
}

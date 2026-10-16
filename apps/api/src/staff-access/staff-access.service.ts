import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  GRANTABLE_STAFF_ROLES,
  isEventBoundStaffRole,
  type GrantableStaffRole,
  type StaffAccessGrantRequest,
  type StaffAccessGrantResponse,
  type StaffAccessRevokeRequest,
  type StaffAccessRow,
} from "@ds/schemas";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  IdpAmbiguousEmailError,
  IdpUnavailableError,
  type IdpClient,
  type IdpProjectGrant,
} from "../auth/idp/idp.types.js";
import { AdminSessionService } from "../auth/admin-session/admin-session.service.js";
import { mirrorRoleFromClaims } from "../auth/staff-role.js";
import {
  StaffAccessRepository,
  isRegistrarBindingConflict,
} from "./staff-access.repository.js";
import { generateTemporaryPassword } from "./temporary-password.js";

/**
 * The refusals of 047 EARS-3 (grant) and EARS-7 (revocation) answered before
 * any write. The `errorCode`
 * is the contract the «Доступы» form reads to show the reason at the field.
 */
export type StaffAccessRefusalCode =
  | "EVENT_NOT_FOUND"
  | "REGISTRAR_BOUND_ELSEWHERE"
  | "GRANT_ALREADY_COMPLETE"
  | "STAFF_GRANT_EMAIL_UNVERIFIED"
  | "STAFF_GRANT_EMAIL_AMBIGUOUS"
  | "REVOKE_SELF_PLATFORM_ADMIN"
  | "REVOKE_ALREADY_COMPLETE";

const REFUSALS: Record<
  StaffAccessRefusalCode,
  { status: HttpStatus; message: string }
> = {
  EVENT_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "the event does not exist",
  },
  REGISTRAR_BOUND_ELSEWHERE: {
    status: HttpStatus.CONFLICT,
    message: "the person is already a registrar of another event",
  },
  GRANT_ALREADY_COMPLETE: {
    status: HttpStatus.CONFLICT,
    message: "the person already holds this access",
  },
  STAFF_GRANT_EMAIL_UNVERIFIED: {
    status: HttpStatus.CONFLICT,
    message: "the email of this account is not verified",
  },
  STAFF_GRANT_EMAIL_AMBIGUOUS: {
    status: HttpStatus.CONFLICT,
    message: "more than one account holds this email",
  },
  REVOKE_SELF_PLATFORM_ADMIN: {
    status: HttpStatus.FORBIDDEN,
    message: "a platform administrator cannot revoke their own platform_admin",
  },
  REVOKE_ALREADY_COMPLETE: {
    status: HttpStatus.CONFLICT,
    message: "this access is already revoked",
  },
};

export class StaffAccessRefusal extends HttpException {
  constructor(readonly errorCode: StaffAccessRefusalCode) {
    const { status, message } = REFUSALS[errorCode];
    super({ statusCode: status, errorCode, message }, status);
  }
}

/** ФИО → the IdP profile: the first word is the family name, the rest the given name (047-design §Grant cascade). */
export function splitFullName(fullName: string): {
  familyName: string;
  givenName: string;
} {
  const [familyName, ...rest] = fullName.split(" ");
  return { familyName: familyName!, givenName: rest.join(" ") };
}

/**
 * 047 — «Доступы»: the list of staff-role holders and the grant cascade
 * (047-design §The list, §Completeness and retry, §Grant cascade).
 *
 * A grant spans the IdP, Postgres and the ledger, so it cannot be one
 * transaction; it is a fixed sequence of idempotent steps, each checking its own
 * state first, so the repeat of a part-failed grant skips what is done and
 * finishes the rest. The `auth.role.granted` row is the completion mark: written
 * once, after the IdP holds the role.
 */
@Injectable()
export class StaffAccessService {
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(StaffAccessRepository) private readonly repo: StaffAccessRepository,
    @Inject(AdminSessionService)
    private readonly adminSessions: AdminSessionService,
  ) {}

  /**
   * EARS-2 — one row per person and role, and per event for an event-bound
   * role. The IdP grant is the authority for who holds a role; the mirror gives
   * the ФИО and email (the IdP projection fills them for an account the mirror
   * lacks); an event-bound role with no binding row is listed with an empty
   * event so a half-finished grant stays visible.
   */
  async list(): Promise<StaffAccessRow[]> {
    const holders = await this.idp.listProjectGrantsWithRoles(
      GRANTABLE_STAFF_ROLES,
    );
    const mirrors = new Map(
      (await this.repo.findMirrorsBySubs(holders.map((h) => h.sub))).map(
        (m) => [m.zitadelSub, m],
      ),
    );
    const bindings = await this.repo.listAllBindings();

    const rows: StaffAccessRow[] = [];
    for (const holder of holders) {
      const mirror = mirrors.get(holder.sub);
      const person = {
        userId: holder.sub,
        fullName: mirror?.displayName ?? holder.displayName ?? null,
        email: mirror?.email ?? holder.email ?? null,
      };
      for (const role of GRANTABLE_STAFF_ROLES) {
        if (!holder.roleKeys.includes(role)) continue;
        if (!isEventBoundStaffRole(role)) {
          rows.push({ ...person, role, eventId: null, eventTitle: null });
          continue;
        }
        const bound = bindings.filter(
          (b) => b.zitadelSub === holder.sub && b.role === role,
        );
        if (bound.length === 0) {
          rows.push({ ...person, role, eventId: null, eventTitle: null });
          continue;
        }
        for (const b of bound) {
          rows.push({
            ...person,
            role,
            eventId: b.eventId,
            eventTitle: b.eventTitle,
          });
        }
      }
    }
    return rows.sort(
      (a, b) =>
        GRANTABLE_STAFF_ROLES.indexOf(a.role) -
          GRANTABLE_STAFF_ROLES.indexOf(b.role) ||
        (a.fullName ?? a.email ?? "").localeCompare(
          b.fullName ?? b.email ?? "",
          "ru",
        ),
    );
  }

  /**
   * EARS-3 — the one account holding `email`, or `null`. The IdP does not keep
   * emails unique; when more than one account holds it, acting on any of them
   * would be a guess, so the grant is refused before any write.
   */
  private async subOfEmail(email: string): Promise<string | null> {
    try {
      return await this.idp.findUserByEmail(email);
    } catch (error) {
      if (error instanceof IdpAmbiguousEmailError) {
        throw new StaffAccessRefusal("STAFF_GRANT_EMAIL_AMBIGUOUS");
      }
      throw error;
    }
  }

  /**
   * Whether the account's email is verified at the IdP. `getUser` answers
   * `null` on a provider hiccup; that must not read as «unverified» — it would
   * refuse a grant the account qualifies for — so it fails loud as an IdP
   * fault.
   */
  private async emailVerifiedOf(sub: string): Promise<boolean> {
    const user = await this.idp.getUser(sub);
    if (!user) {
      throw new IdpUnavailableError("the IdP did not return the account");
    }
    return user.emailVerified;
  }

  /**
   * EARS-3…EARS-6, EARS-9 — the grant cascade, run under the per-email grant
   * lock so two grants for one person never interleave: the second reads the
   * state the first left (and is refused as complete). Validation, the
   * completeness read and every refusal come first, before any write — an
   * existing account whose email is not verified is refused there — then (1)
   * the account, (2) the role on the IdP grant, (3) one DB transaction —
   * mirror, binding, audit mark — and (4) the temporary password, last, so a
   * password is only ever set by a request that then answers `201` with it.
   */
  async grant(
    input: StaffAccessGrantRequest,
    byAdmin: string,
  ): Promise<StaffAccessGrantResponse> {
    return this.repo.withGrantLock(input.email, () =>
      this.grantLocked(input, byAdmin),
    );
  }

  private async grantLocked(
    input: StaffAccessGrantRequest,
    byAdmin: string,
  ): Promise<StaffAccessGrantResponse> {
    const role: GrantableStaffRole = input.role;
    const eventId = isEventBoundStaffRole(role)
      ? (input.eventId ?? null)
      : null;

    const event = eventId === null ? null : await this.repo.findEvent(eventId);
    if (eventId !== null && !event) {
      throw new StaffAccessRefusal("EVENT_NOT_FOUND");
    }

    // ---- Completeness read: IdP user, grant and password; mirror; bindings.
    let sub = await this.subOfEmail(input.email);
    let grant: IdpProjectGrant | null = null;
    let hasPassword = false;
    if (sub) {
      // EARS-3: an existing account whose email nobody proved belongs to
      // whoever registered it, not necessarily to the person the administrator
      // named; the grant is refused with nothing changed. The person proves the
      // mailbox (the email-code sign-in) and the administrator repeats it.
      if (!(await this.emailVerifiedOf(sub))) {
        throw new StaffAccessRefusal("STAFF_GRANT_EMAIL_UNVERIFIED");
      }
      grant = await this.idp.getProjectGrant(sub);
      hasPassword = await this.idp.userHasPassword(sub);
    }
    const mirror = sub ? await this.repo.findMirrorBySub(sub) : undefined;

    let bindingPresent = true;
    if (eventId !== null && isEventBoundStaffRole(role)) {
      const bindings = mirror
        ? await this.repo.listBindings(mirror.id, role)
        : [];
      // 044 EARS-38: a registrar works exactly one event.
      if (
        role === "event-registrar" &&
        bindings.some((b) => b.eventId !== eventId)
      ) {
        throw new StaffAccessRefusal("REGISTRAR_BOUND_ELSEWHERE");
      }
      bindingPresent = bindings.some((b) => b.eventId === eventId);
    }

    const roleHeld = grant?.roleKeys.includes(role) ?? false;
    if (sub && roleHeld && bindingPresent && hasPassword && mirror) {
      const latest = await this.repo.latestRoleEvent(sub, role, eventId);
      if (latest === "auth.role.granted") {
        throw new StaffAccessRefusal("GRANT_ALREADY_COMPLETE");
      }
    }

    // ---- (1) The account (EARS-5): a verified human user named by the ФИО.
    if (!sub) {
      const created = await this.idp.createUser({
        email: input.email,
        credential: "none",
        profile: {
          ...splitFullName(input.fullName),
          displayName: input.fullName,
        },
        emailVerified: true,
      });
      if (!created.sub) {
        throw new IdpUnavailableError(
          "the IdP reported the email as taken but named no account",
        );
      }
      sub = created.sub;
      if (created.alreadyExisted) {
        // Lost a race with another create: continue on the existing account,
        // under the same EARS-3 refusal as one found by the read above.
        if (!(await this.emailVerifiedOf(sub))) {
          throw new StaffAccessRefusal("STAFF_GRANT_EMAIL_UNVERIFIED");
        }
        grant = await this.idp.getProjectGrant(sub);
        hasPassword = await this.idp.userHasPassword(sub);
      }
    }

    // ---- (2) The role on the IdP grant (EARS-4/5), keeping every other role.
    let roleKeys: string[];
    if (!grant) {
      roleKeys = [DOCTOR_GUEST_ROLE, role];
      await this.idp.grantProjectRole(sub, roleKeys);
    } else if (!grant.roleKeys.includes(role)) {
      roleKeys = [...grant.roleKeys, role];
      await this.idp.updateProjectGrantRoles(sub, grant.grantId, roleKeys);
    } else {
      roleKeys = grant.roleKeys;
    }

    // ---- (3) Mirror, binding and the completion mark — one transaction.
    try {
      await this.repo.commitGrant({
        sub,
        email: input.email,
        fullName: input.fullName,
        mirrorRole: mirrorRoleFromClaims(roleKeys),
        role,
        eventId,
        byAdmin,
      });
    } catch (error) {
      // 044 EARS-38 is the database's invariant, not only the read above: a
      // registrar binding written by a path outside the grant lock after the
      // completeness read trips the partial unique index; the transaction rolls
      // back (no binding, no mark) and the grant answers the same refusal.
      if (isRegistrarBindingConflict(error)) {
        throw new StaffAccessRefusal("REGISTRAR_BOUND_ELSEWHERE");
      }
      throw error;
    }

    // ---- (4) The temporary password (EARS-6): for an account without one.
    let temporaryPassword: string | undefined;
    if (!hasPassword) {
      const password = generateTemporaryPassword();
      await this.idp.setUserPassword(sub, password);
      temporaryPassword = password;
    }

    const saved = await this.repo.findMirrorBySub(sub);
    return {
      row: {
        userId: sub,
        fullName: saved?.displayName ?? input.fullName,
        email: saved?.email ?? input.email,
        role,
        eventId,
        eventTitle: event?.title ?? null,
      },
      ...(temporaryPassword === undefined ? {} : { temporaryPassword }),
    };
  }

  /**
   * EARS-7, EARS-9 — the revocation cascade (047-design §Revoke cascade), run
   * under the per-account revoke lock so two revocations of one person never
   * interleave. Refusals first; then (2) the binding, (3) the role on the IdP
   * grant, (4) every admin session and pending sign-in — always, also when (2)
   * or (3) failed — and (5), only when all of those succeeded, one DB
   * transaction: the mirror and the `auth.role.revoked` completion mark.
   */
  async revoke(
    input: StaffAccessRevokeRequest,
    byAdmin: string,
  ): Promise<void> {
    // EARS-7: no self-lockout, so the last administrator can never remove
    // themselves.
    if (input.userId === byAdmin && input.role === "platform_admin") {
      throw new StaffAccessRefusal("REVOKE_SELF_PLATFORM_ADMIN");
    }
    return this.repo.withRevokeLock(input.userId, () =>
      this.revokeLocked(input, byAdmin),
    );
  }

  private async revokeLocked(
    input: StaffAccessRevokeRequest,
    byAdmin: string,
  ): Promise<void> {
    const sub = input.userId;
    const role: GrantableStaffRole = input.role;
    const boundRole = isEventBoundStaffRole(role) ? role : null;
    const eventId = boundRole === null ? null : (input.eventId ?? null);

    // ---- Completeness read: IdP grant; mirror; bindings of this role.
    const grant = await this.idp.getProjectGrant(sub);
    const mirror = await this.repo.findMirrorBySub(sub);
    const bindings =
      mirror && boundRole !== null
        ? await this.repo.listBindings(mirror.id, boundRole)
        : [];
    const bindingPresent =
      eventId !== null && bindings.some((b) => b.eventId === eventId);
    const otherBinding = bindings.some((b) => b.eventId !== eventId);
    const removeFromGrant =
      (grant?.roleKeys.includes(role) ?? false) && !otherBinding;

    if (!bindingPresent && !removeFromGrant) {
      const latest = await this.repo.latestRoleEvent(sub, role, eventId);
      if (latest === "auth.role.revoked") {
        throw new StaffAccessRefusal("REVOKE_ALREADY_COMPLETE");
      }
    }

    let remaining: readonly string[] = grant?.roleKeys ?? [];
    let failure: unknown;
    try {
      // ---- (2) The binding first: fail-closed for that event from here on.
      if (bindingPresent && boundRole !== null && eventId !== null) {
        await this.repo.deleteBinding({
          userId: mirror!.id,
          role: boundRole,
          eventId,
        });
      }
      // ---- (3) The role off the IdP grant, keeping every other role.
      if (removeFromGrant) {
        remaining = grant!.roleKeys.filter((key) => key !== role);
        if (remaining.length === 0) {
          // A grant always carries `doctor_guest` beside a staff role (EARS-4/5);
          // one holding only this role predates that, and whether the IdP
          // accepts an empty role set is unproven — fail loud, never guess.
          throw new Error(
            "the grant would be left without roles; an empty role set is not written",
          );
        }
        await this.idp.updateProjectGrantRoles(sub, grant!.grantId, remaining);
      }
    } catch (error) {
      failure = error;
    }

    // ---- (4) Sessions — always (047-design: fail-safe on an IdP failure).
    await this.adminSessions.endAllAdminAccess(sub);
    if (failure !== undefined) throw failure;

    // ---- (5) Mirror and the completion mark — one transaction.
    await this.repo.commitRevocation({
      sub,
      mirrorRole: mirrorRoleFromClaims(remaining),
      role,
      eventId,
      byAdmin,
    });
  }
}

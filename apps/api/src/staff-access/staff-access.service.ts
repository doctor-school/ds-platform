import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  GRANTABLE_STAFF_ROLES,
  isEventBoundStaffRole,
  type GrantableStaffRole,
  type StaffAccessGrantRequest,
  type StaffAccessGrantResponse,
  type StaffAccessRow,
} from "@ds/schemas";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  IdpUnavailableError,
  type IdpClient,
  type IdpProjectGrant,
} from "../auth/idp/idp.types.js";
import { mirrorRoleFromClaims } from "../auth/staff-role.js";
import { SessionService } from "../auth/session/session.service.js";
import { AdminSessionService } from "../auth/admin-session/admin-session.service.js";
import { StaffAccessRepository } from "./staff-access.repository.js";
import { generateTemporaryPassword } from "./temporary-password.js";

/**
 * The refusals of 047 EARS-3 a grant answers before any write. The `errorCode`
 * is the contract the «Доступы» form reads to show the reason at the field.
 */
export type StaffAccessRefusalCode =
  | "EVENT_NOT_FOUND"
  | "REGISTRAR_BOUND_ELSEWHERE"
  | "GRANT_ALREADY_COMPLETE";

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
    @Inject(SessionService) private readonly portalSessions: SessionService,
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
   * EARS-3…EARS-6, EARS-9 — the grant cascade. Validation and the completeness
   * read first, before any write; then (1) the account, (2) the role on the IdP
   * grant, (3) one DB transaction — mirror, binding, audit mark — and (4) the
   * temporary password, last, so a password is only ever set by a request that
   * then answers `201` with it.
   */
  /**
   * Whether the account's email is verified at the IdP. `getUser` answers
   * `null` on a provider hiccup; that must not read as «unverified» — it would
   * reset a real owner's password — so it fails loud as an IdP fault.
   */
  private async emailVerifiedOf(sub: string): Promise<boolean> {
    const user = await this.idp.getUser(sub);
    if (!user) {
      throw new IdpUnavailableError("the IdP did not return the account");
    }
    return user.emailVerified;
  }

  async grant(
    input: StaffAccessGrantRequest,
    byAdmin: string,
  ): Promise<StaffAccessGrantResponse> {
    const role: GrantableStaffRole = input.role;
    const eventId = isEventBoundStaffRole(role) ? (input.eventId ?? null) : null;

    const event = eventId === null ? null : await this.repo.findEvent(eventId);
    if (eventId !== null && !event) {
      throw new StaffAccessRefusal("EVENT_NOT_FOUND");
    }

    // ---- Completeness read: IdP user, grant and password; mirror; bindings.
    let sub = await this.idp.findUserByEmail(input.email);
    let grant: IdpProjectGrant | null = null;
    let hasPassword = false;
    let emailVerified = true;
    if (sub) {
      grant = await this.idp.getProjectGrant(sub);
      hasPassword = await this.idp.userHasPassword(sub);
      emailVerified = await this.emailVerifiedOf(sub);
    }
    const mirror = sub ? await this.repo.findMirrorBySub(sub) : undefined;

    let bindingPresent = true;
    if (eventId !== null && isEventBoundStaffRole(role)) {
      const bindings = mirror ? await this.repo.listBindings(mirror.id, role) : [];
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
    if (
      sub &&
      roleHeld &&
      bindingPresent &&
      hasPassword &&
      emailVerified &&
      mirror
    ) {
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
        // Lost a race with another create: continue on the existing account.
        grant = await this.idp.getProjectGrant(sub);
        hasPassword = await this.idp.userHasPassword(sub);
        emailVerified = await this.emailVerifiedOf(sub);
      }
    }

    // ---- (1b) An existing account whose email nobody proved (EARS-4/EARS-6).
    // Anyone can register or submit the congress form with a staff member's
    // address before the grant; that account's password and sessions belong to
    // whoever did it, not to the person the administrator named. So before the
    // role reaches it, the account is closed to its current holder: a fresh
    // unshown password replaces any it had and every session ends. The shown
    // temporary password and the verified email come in step (4); a retry of a
    // part-failed grant still sees the email unverified and repeats this step.
    if (!emailVerified) {
      if (hasPassword) {
        await this.idp.setUserPassword(sub, generateTemporaryPassword());
      }
      await this.portalSessions.revokeAllBeforeVerification(sub);
      await this.adminSessions.forceLogout(sub);
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
    await this.repo.commitGrant({
      sub,
      email: input.email,
      fullName: input.fullName,
      mirrorRole: mirrorRoleFromClaims(roleKeys),
      role,
      eventId,
      byAdmin,
    });

    // ---- (4) The temporary password (EARS-6): for an account without one, and
    // for one whose email was unverified (its password was not the staff
    // member's). Then the email is marked verified — the administrator vouches
    // for the address they typed — last, so an interrupted grant stays
    // unverified and its repeat issues the password again.
    let temporaryPassword: string | undefined;
    if (!hasPassword || !emailVerified) {
      const password = generateTemporaryPassword();
      await this.idp.setUserPassword(sub, password);
      temporaryPassword = password;
    }
    if (!emailVerified) {
      // `markEmailVerified` answers `false` both for «already verified» and for
      // a failed flip; only a re-read tells them apart, and a grant that ends
      // unverified must not answer 201 (its repeat would replace the password
      // the administrator just handed over).
      const flipped = await this.idp.markEmailVerified(sub);
      if (!flipped && !(await this.emailVerifiedOf(sub))) {
        throw new IdpUnavailableError("the IdP did not mark the email verified");
      }
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
}

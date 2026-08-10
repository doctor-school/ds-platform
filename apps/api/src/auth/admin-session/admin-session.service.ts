import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AdminAuthState, AdminEnrollmentOffer } from "@ds/schemas";
import { IDP_CLIENT, type IdpClient } from "../idp/idp.types.js";
import {
  AUTH_AUDIT,
  type AuthAuditLog,
  type AdminSessionEndReason,
} from "../session/auth-audit.types.js";
import {
  clearAdminCsrfCookie,
  clearAdminPendingCookie,
  clearAdminSessionCookie,
  serializeAdminCsrfCookie,
  serializeAdminPendingCookie,
  serializeAdminSessionCookie,
} from "./admin-session.cookie.js";
import { requiresMfa } from "./mfa-policy.js";
import {
  ADMIN_SESSION_STORE,
  PENDING_AUTH_STORE,
  type AdminNextStep,
  type AdminSessionRecord,
  type AdminSessionStore,
  type PendingAuthRecord,
  type PendingAuthStore,
} from "./admin-session.types.js";

/**
 * Pending-auth lifetime — **minutes, not hours** (011 design §3). It bounds the
 * window in which the checked-Zitadel-session proof-of-check sits server-side
 * waiting for a second factor; long enough to scan a QR and type a code, short
 * enough that an abandoned primary auth is not a standing artifact.
 */
const PENDING_TTL_SECONDS = 5 * 60;

/**
 * Admin session lifetime. EARS-10 is explicit that the admin tier is **not a new
 * session model** — it conforms to the ADR-0001 §6 / design §7.1 profile, whose
 * web-session lifetime is the 30-day opaque refresh lifetime. Kept as its own
 * named constant (rather than importing the 003 one) so the admin tier's profile
 * is legible at a glance and a future tightening is a one-line data change here,
 * not a silent divergence discovered in a diff.
 */
const ADMIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * EARS-5: read the issuer/account labels out of the provisioning URI the IdP
 * minted, so the offer's four fields all describe **one** registration.
 *
 * Deriving them rather than composing our own is the point: the authenticator app
 * files the factor under whatever the URI says, so a label we invented here would
 * disagree with what the operator actually sees on their phone. `otpauth://totp/`
 * carries the label as `issuer:account` in the path with `issuer` repeated as a
 * query parameter (the form this repo's fake and Zitadel both emit). A URI that
 * does not parse falls back to the platform label and the subject — a
 * cosmetically poorer offer, never a broken enrollment.
 */
function labelsFrom(
  uri: string,
  sub: string,
): { issuer: string; account: string } {
  const match = /^otpauth:\/\/totp\/([^?]*)/.exec(uri);
  const label = decodeURIComponent(match?.[1] ?? "");
  const separator = label.indexOf(":");
  const query = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  const issuer =
    query.get("issuer") ??
    (separator > 0 ? label.slice(0, separator) : DEFAULT_TOTP_ISSUER);
  const account = separator >= 0 ? label.slice(separator + 1) : label;
  return {
    issuer: issuer || DEFAULT_TOTP_ISSUER,
    account: account || sub,
  };
}

/**
 * The label shown when the provisioning URI carries none. A product name, not an
 * origin or endpoint — the AGENTS.md §9 no-hardcoded-endpoint rule does not reach
 * it, and an authenticator entry with no issuer is unusable for an operator
 * holding several factors.
 */
const DEFAULT_TOTP_ISSUER = "Doctor.School";

/** What `startLogin` resolved to — the EARS-3 policy fork, or a uniform refusal. */
export type AdminLoginOutcome =
  | {
      status: "pending";
      /** `Set-Cookie` for `__Host-ds_admin_pending`. */
      cookie: string;
      /** The state the admin app renders from — the enum and nothing else. */
      state: Extract<
        AdminAuthState,
        "mfa_pending_enrollment" | "mfa_pending_challenge"
      >;
    }
  /**
   * Every refusal branch — wrong password, unknown identifier, locked account,
   * and a principal the policy does not cover — collapses here. The caller
   * answers all of them with the identical generic 401 (ADR-0001 §7
   * enumeration-safety; the discriminating reason lives only in the ledger).
   */
  | { status: "refused" };

/** The validated admin principal every admin route resolves (design → Read models). */
export interface AdminSessionPrincipal {
  sub: string;
  roles: string[];
  /** Always `true` — an admin session with `mfa = false` is not a supported state. */
  mfa: true;
  sid: string;
}

/**
 * Owns the 011 admin authentication tier (EARS-1, EARS-2, EARS-3, EARS-10).
 *
 * The structural change this service exists to make: **primary authentication at
 * the admin origin no longer produces a session.** It produces a pending
 * authentication — a short-lived, server-side, single-purpose reference — and
 * only a satisfied second factor converts that into `__Host-ds_admin_session`.
 *
 * Everything else is composition over the shipped 003 machinery (Zitadel session
 * check, OIDC exchange, `mfa` claim, Redis store, fingerprint binding): 011
 * introduces no new token type, no new credential store, and no second identity
 * source (011 Constraints → _no new auth primitive_).
 */
@Injectable()
export class AdminSessionService {
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(ADMIN_SESSION_STORE) private readonly sessions: AdminSessionStore,
    @Inject(PENDING_AUTH_STORE) private readonly pending: PendingAuthStore,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
  ) {}

  /**
   * EARS-3 — `StartAdminLogin`. Primary password authentication at the admin
   * origin, then the `role → mfa_required` policy evaluated **immediately
   * after**: a principal holding a policy role never receives a session here.
   *
   * The OIDC exchange runs on this path because it is where the IdP asserts the
   * principal's roles, and the policy fork is a decision *about the roles*. Its
   * output does not become a session: the tokens and the checked-session handle
   * go into the {@link PendingAuthRecord}, which is server-side only, lives in
   * its own key namespace, expires in minutes, and is refused by the admin
   * session hook. The record is later **upgraded in place** into the session
   * (LD-1) by {@link upgradePending}, so no second login and no second exchange
   * is needed once the factor is satisfied.
   *
   * A principal the policy does NOT cover is `refused`, not admitted: the admin
   * origin is not a general login surface, and admitting a non-policy role here
   * would create a second, weaker way into the admin tier.
   */
  async startLogin(
    identifier: string,
    password: string,
    fingerprint: string,
  ): Promise<AdminLoginOutcome> {
    const result = await this.idp.passwordLogin(identifier, password);
    if (result.outcome !== "authenticated") {
      await this.audit.record({
        type: "AdminPrimaryAuthFailed",
        identifier,
        sub: null,
        reason: result.outcome === "locked" ? "lock" : "wrong_password",
      });
      return { status: "refused" };
    }

    const tokens = await this.idp.exchangeSessionForTokens(result.session);
    const { sub, roles } = tokens.claims;

    // EARS-3: the policy fork. A role NOT in the policy gets no admin session and
    // no pending reference — the uniform refusal, recorded as a failure.
    //
    // The row tells the truth about this branch: the credentials were VALID and
    // the IdP asserted this subject, the policy simply does not cover it. That is
    // the sharpest signal the admin surface can produce (a stolen doctor password
    // probed at the admin origin), so it is recorded with its own reason and its
    // subject rather than collapsed into the anonymous `no_user` of an unknown
    // identifier. The reason and the subject are audit-only — the response below
    // is the same uniform refusal every other branch returns (EARS-16).
    if (!requiresMfa(roles)) {
      // The password check already created a Zitadel session; the BFF is refusing
      // the request it was created for, so it does not get to outlive the refusal.
      await this.idp.terminateSession(result.session);
      await this.audit.record({
        type: "AdminPrimaryAuthFailed",
        identifier,
        sub,
        reason: "not_permitted",
      });
      return { status: "refused" };
    }

    await this.audit.record({ type: "AdminPrimaryAuthSucceeded", sub });

    const nextStep: AdminNextStep = (await this.idp.hasTotpFactor(sub))
      ? "mfa_challenge_required"
      : "mfa_enrollment_required";

    const record: PendingAuthRecord = {
      ref: randomUUID(),
      sub,
      roles,
      nextStep,
      zitadelSessionId: result.session.zitadelSessionId,
      sessionToken: result.session.sessionToken,
      fingerprint,
      expiresAtMs: Date.now() + PENDING_TTL_SECONDS * 1000,
    };
    await this.pending.create(record);

    return {
      status: "pending",
      cookie: serializeAdminPendingCookie(record.ref, {
        maxAgeSeconds: PENDING_TTL_SECONDS,
      }),
      state:
        nextStep === "mfa_challenge_required"
          ? "mfa_pending_challenge"
          : "mfa_pending_enrollment",
    };
  }

  /** Resolve a pending authentication by its reference (EARS-3). */
  getPending(ref: string): Promise<PendingAuthRecord | undefined> {
    return this.pending.get(ref);
  }

  /**
   * EARS-4 — resolve the pending authentication a request may act on, or
   * `undefined`.
   *
   * This is the gate the two enrollment endpoints sit behind, and it is
   * deliberately **one** function: every condition that must hold for a caller to
   * be "in `mfa_pending_enrollment`" is checked in a single place, so no handler
   * can be written that checks three of the four. A caller passes only when it
   * presents a live pending reference, bound to THIS device's fingerprint, whose
   * next step is the one the route serves.
   *
   * A caller holding an established admin session is NOT pending and gets
   * `undefined` — the enrollment endpoints exist for one state, not "any admin
   * credential" (011 Constraints: the pending-auth state is not a session, and
   * the converse holds too).
   */
  async getPendingForStep(
    ref: string,
    fingerprint: string,
    step: AdminNextStep,
  ): Promise<PendingAuthRecord | undefined> {
    if (!ref) return undefined;
    const record = await this.pending.get(ref);
    if (!record) return undefined;
    if (record.fingerprint !== fingerprint) return undefined;
    if (record.nextStep !== step) return undefined;
    return record;
  }

  /**
   * EARS-5 — `StartMfaEnrollment`. Register a **provisional** TOTP factor for the
   * pending principal and return the one-time offer: the scannable provisioning
   * URI, the same secret in transcribable form, and the issuer/account labels.
   *
   * **Nothing durable is emitted.** The factor is not yet confirmed, so there is
   * no lifecycle event to record — `auth.mfa.enrolled` is written by
   * {@link verifyEnrollment}, and only for a factor an operator has proven they
   * hold. Recording an "enrollment started" row would also be the one place the
   * secret could plausibly leak into the ledger.
   *
   * **The offer is not re-servable.** A second call registers a NEW provisional
   * factor with a NEW secret and the previous one stops verifying (the
   * {@link IdpClient.startTotpRegistration} contract). An operator who lost the
   * screen gets a fresh factor, never a second look at the old secret — which is
   * what makes "shown exactly once" true rather than aspirational.
   *
   * Resolves `undefined` when the caller is not a pending-enrollment principal;
   * the handler answers that with the same uniform refusal as a wrong code.
   */
  async startEnrollment(
    ref: string,
    fingerprint: string,
  ): Promise<AdminEnrollmentOffer | undefined> {
    const record = await this.getPendingForStep(
      ref,
      fingerprint,
      "mfa_enrollment_required",
    );
    if (!record) return undefined;

    const registration = await this.idp.startTotpRegistration(record.sub);
    return {
      provisioningUri: registration.uri,
      secret: registration.secret,
      ...labelsFrom(registration.uri, record.sub),
    };
  }

  /**
   * EARS-5 — `VerifyMfaEnrollment`. Verify the first code against the provisional
   * factor and, on success, complete the login **in place** (LD-1).
   *
   * The ordering is the requirement: confirm the factor at the IdP → append
   * `auth.mfa.enrolled` → upgrade the pending record into a full admin session.
   * Both factors have been presented in this login (a completed password
   * authentication, PD-1, plus a TOTP verification of the factor just
   * registered), so forcing a second full login would add friction that proves
   * nothing — the ADR-0001 design §8.5 re-login step exists because ITS vehicle
   * is a magic link, a weaker primary credential (LD-1).
   *
   * Resolves `undefined` for every refusal — wrong code, expired window, replayed
   * code, no provisional factor, a stale or foreign pending reference — so the
   * handler answers all of them identically (EARS-7). The pending authentication
   * **survives** a wrong code: the operator retries against the same provisional
   * factor rather than being thrown back to the login screen.
   */
  async verifyEnrollment(
    ref: string,
    fingerprint: string,
    code: string,
  ): Promise<
    { cookies: string[]; principal: AdminSessionPrincipal } | undefined
  > {
    const record = await this.getPendingForStep(
      ref,
      fingerprint,
      "mfa_enrollment_required",
    );
    if (!record) return undefined;

    const verified = await this.idp.verifyTotpRegistration(record.sub, code);
    if (!verified) return undefined;

    await this.audit.record({ type: "MfaEnrolled", sub: record.sub });
    return this.upgradePending(ref, fingerprint);
  }

  /**
   * EARS-1 + LD-1 — upgrade a pending authentication **in place** into the
   * dedicated admin session, issuing `__Host-ds_admin_session` (host-only,
   * `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`, opaque reference) plus the
   * EARS-10 CSRF double-submit cookie. The portal cookie is neither set nor
   * modified, and no token appears in any response body.
   *
   * **Contract — this method presumes a satisfied second factor.** Its callers
   * are the enrollment-verify and challenge-verify handlers, which land with
   * EARS-5/EARS-6 (#1191/#1192); no HTTP route in this slice reaches it, which is
   * the WBS sequencing this Issue owns rather than a hidden bypass — the tests
   * drive it directly, exactly as the verify handlers will. `mfa: true` is
   * written unconditionally because there is no other way into this method.
   *
   * Resolves `undefined` when the reference is unknown/expired or its bound
   * fingerprint diverges (a pending reference replayed from another device does
   * not upgrade).
   */
  async upgradePending(
    ref: string,
    fingerprint: string,
  ): Promise<
    { cookies: string[]; principal: AdminSessionPrincipal } | undefined
  > {
    const record = await this.pending.get(ref);
    if (!record) return undefined;
    if (record.fingerprint !== fingerprint) return undefined;

    // The exchange runs for its effect, not its payload: it is the IdP's
    // re-assertion that the checked session behind this pending reference is
    // still live, and it consumes the single-use proof-of-check. Its token
    // material is deliberately dropped — the admin session record holds no IdP
    // token at rest, because nothing on this tier reads one.
    await this.idp.exchangeSessionForTokens({
      zitadelSessionId: record.zitadelSessionId,
      sub: record.sub,
      sessionToken: record.sessionToken,
    });

    const session: AdminSessionRecord = {
      sid: randomUUID(),
      zitadelSessionId: record.zitadelSessionId,
      sub: record.sub,
      roles: record.roles,
      mfa: true,
      fingerprint,
      csrfToken: randomUUID(),
      expiresAtMs: Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000,
    };
    await this.sessions.create(session);
    // The pending record is consumed by the upgrade — it never coexists with the
    // session it became (design §8: "upgrades into (never coexists)").
    await this.pending.delete(ref);
    await this.audit.record({
      type: "AdminSessionEstablished",
      sub: session.sub,
      sid: session.sid,
    });

    return {
      cookies: [
        serializeAdminSessionCookie(session.sid, {
          maxAgeSeconds: ADMIN_SESSION_TTL_SECONDS,
        }),
        serializeAdminCsrfCookie(session.csrfToken, {
          maxAgeSeconds: ADMIN_SESSION_TTL_SECONDS,
        }),
      ],
      principal: {
        sub: session.sub,
        roles: session.roles,
        mfa: true,
        sid: session.sid,
      },
    };
  }

  /** Resolve an admin session by its cookie `sid` (used by the admin auth hook). */
  getBySid(sid: string): Promise<AdminSessionRecord | undefined> {
    return this.sessions.get(sid);
  }

  /**
   * EARS-2 — `EndAdminSession`. Deletes the admin session record and returns the
   * cookies that clear the admin pair. **Scoped**: it touches no portal session
   * and clears no portal cookie, so a concurrent `__Host-ds_session` stays valid.
   * Idempotent — an unknown `sid` still returns the clearing cookies but emits no
   * event (there was nothing to terminate).
   */
  async logout(sid: string): Promise<{ cookies: string[] }> {
    const record = await this.sessions.get(sid);
    if (record) {
      await this.sessions.delete(sid);
      await this.audit.record({
        type: "AdminSessionEnded",
        sub: record.sub,
        sid,
        reason: "logout",
      });
    }
    return {
      cookies: [clearAdminSessionCookie(), clearAdminCsrfCookie()],
    };
  }

  /** The cookie that clears an abandoned/expired pending reference (EARS-3). */
  clearPending(): string {
    return clearAdminPendingCookie();
  }

  /**
   * EARS-10 force-logout: revoke **every** admin session belonging to `sub`,
   * recording one terminal `auth.session.terminated` row per revoked session with
   * `reason: "force"`. The revocation primitive ADR-0001 §6 requires; portal
   * sessions of the same subject are deliberately untouched (EARS-2 separation).
   */
  async forceLogout(
    sub: string,
    reason: AdminSessionEndReason = "force",
  ): Promise<void> {
    const revoked = await this.sessions.deleteBySub(sub);
    for (const sid of revoked) {
      await this.audit.record({
        type: "AdminSessionEnded",
        sub,
        sid,
        reason,
      });
    }
  }
}

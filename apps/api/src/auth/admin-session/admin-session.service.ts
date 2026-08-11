import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AdminAuthState, AdminEnrollmentOffer } from "@ds/schemas";
import { MAILER, type Mailer } from "../../mailer/mailer.types.js";
import {
  IDP_CLIENT,
  type IdpClient,
  type IdpSession,
} from "../idp/idp.types.js";
import { totpParametersFrom, totpProvisioningUri } from "../idp/totp.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import {
  AUTH_AUDIT,
  type AuthAuditLog,
  type AdminMfaStage,
  type AdminSessionEndReason,
} from "../session/auth-audit.types.js";
import { MfaLockoutService } from "./mfa-lockout.service.js";
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
 * EARS-5: the issuer an admin's authenticator app files this factor under.
 *
 * A **product brand string, verbatim and never translated** — it is what the
 * operator reads in a list of one-time-code entries, so it must name the thing
 * they are logging into. It is not an origin or an endpoint, so the AGENTS.md §9
 * no-hardcoded-endpoint rule does not reach it.
 *
 * `Admin` is part of the name on purpose: an operator can hold a Doctor.School
 * factor for more than one surface, and two entries both reading "Doctor.School"
 * are indistinguishable at exactly the moment they are needed.
 */
const ADMIN_TOTP_ISSUER = "Doctor.School Admin";

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

/**
 * What a TOTP verification (enrollment or challenge) resolved to (EARS-6/EARS-7).
 *
 * `refused` is **one** member covering every discriminable cause — wrong code,
 * expired window, replay, no factor, stale/foreign pending reference, soft-lock —
 * because the handler must answer all of them identically and a richer type here
 * would be a standing invitation to branch on it (EARS-7). `throttled` is the
 * separate ADR-0001 §7 rate-limit answer, which is not an account signal: it
 * reports the caller's OWN attempt rate, something the caller already knows.
 */
export type AdminMfaVerifyOutcome =
  | { status: "verified"; cookies: string[]; principal: AdminSessionPrincipal }
  | { status: "refused" }
  | { status: "throttled" };

/**
 * What the EARS-13 factor-removal command resolved to.
 *
 * `refused` and `throttled` are deliberately the SAME two members the verify
 * surfaces return, and the handler answers them identically: EARS-13 states that a
 * missing / wrong / expired / replayed caller code refuses "under the same
 * uniform-failure and rate-limit discipline as EARS-7 — no distinct error, no
 * separate attempt budget". A richer failure type here would be a standing
 * invitation to branch on it.
 *
 * `self_removal` is the one refusal that is NOT a code outcome and is therefore
 * allowed its own answer: the caller aimed the command at themselves, and they
 * already know their own subject, so naming the reason discloses nothing to them
 * that they did not supply. It is resolved BEFORE any verification, so an operator
 * error costs neither an attempt budget nor a lockout unit.
 */
export type AdminFactorRemovalOutcome =
  | { status: "removed" }
  | { status: "refused" }
  | { status: "throttled" }
  | { status: "self_removal" };

/**
 * The generic result of a guarded TOTP check — the EARS-7 envelope, independent
 * of what the proven value is.
 */
type GuardedCheckOutcome<T> =
  | { status: "verified"; proven: T }
  | { status: "refused" }
  | { status: "throttled" };

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
  private readonly logger = new Logger(AdminSessionService.name);

  // The `@Inject`-annotated parameters come FIRST (the `AuthController` /
  // `AdminSessionAuthHook` hazard): tsx/esbuild mis-emits `design:paramtypes`
  // when a type-inferred parameter precedes an `@Inject` one, breaking DI for the
  // whole class under the endpoint-authz lint gate's runtime.
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(ADMIN_SESSION_STORE) private readonly sessions: AdminSessionStore,
    @Inject(PENDING_AUTH_STORE) private readonly pending: PendingAuthStore,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly limiter: RateLimitService,
    private readonly lockout: MfaLockoutService,
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

    // Everything past the password check runs under a disposal guard. A throw
    // here (an IdP fault on the token exchange or the #1208 factor read) abandons
    // the request the Zitadel session was created for, so the session must not
    // outlive it — the same disposal the non-policy refusal below performs,
    // extended to the fault path. Without it a persistent fault leaks one live
    // IdP session per login attempt. The disposal is fail-soft: it must never
    // replace the original fault with a second one, which the caller maps to its
    // HTTP status (`AdminAuthController.login` → 503).
    try {
      return await this.startLoginAfterPassword(
        identifier,
        fingerprint,
        result.session,
      );
    } catch (cause) {
      try {
        await this.idp.terminateSession(result.session);
      } catch {
        /* the fault below is the one worth reporting */
      }
      throw cause;
    }
  }

  /**
   * The post-password remainder of {@link startLogin} — the OIDC exchange, the
   * EARS-3 policy fork, and the pending record. Split out so the caller can wrap
   * exactly this span in the Zitadel-session disposal guard: every exit that is
   * not a returned outcome leaves the checked session behind.
   */
  private async startLoginAfterPassword(
    identifier: string,
    fingerprint: string,
    session: IdpSession,
  ): Promise<AdminLoginOutcome> {
    const tokens = await this.idp.exchangeSessionForTokens(session);
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
      await this.idp.terminateSession(session);
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
      identifier,
      roles,
      nextStep,
      zitadelSessionId: session.zitadelSessionId,
      sessionToken: session.sessionToken,
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
   * **The provisioning URI is rebuilt here, not passed through.** Zitadel's
   * `POST /v2/users/{id}/totp` answers with an `otpauth://` URI carrying ITS own
   * default label, so an operator who scanned it got an authenticator entry
   * reading «Zitadel» — the name of a component they have never heard of, on the
   * one screen where they need to know which login this code belongs to (owner
   * Stage-B verdict on #1192). The IdP owns the secret; the product owns the
   * label. So the same secret is re-emitted under {@link ADMIN_TOTP_ISSUER} and
   * the operator's own email, and the IdP's declared `algorithm`/`digits`/`period`
   * are copied through verbatim — re-labelling must never silently change the
   * parameters the app computes codes with.
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
    const account = await this.accountLabelFor(record);
    return {
      provisioningUri: totpProvisioningUri({
        issuer: ADMIN_TOTP_ISSUER,
        account,
        secret: registration.secret,
        ...totpParametersFrom(registration.uri),
      }),
      secret: registration.secret,
      issuer: ADMIN_TOTP_ISSUER,
      account,
    };
  }

  /**
   * The account label the authenticator entry carries — the operator's **email**,
   * because that is what they recognise as "who am I logging in as" and what the
   * owner asked the entry to read.
   *
   * The IdP is the authority for it (`apps/api` holds no admin mailbox of its
   * own). Fail-soft, and the fallbacks are ordered by how useful they are to a
   * human reading a list on their phone: the identifier they typed at the login
   * form, then the opaque subject. A label is never worth failing an enrollment
   * over — an operator with a poorly-named entry can still log in; one who cannot
   * enrol at all cannot.
   */
  private async accountLabelFor(record: PendingAuthRecord): Promise<string> {
    try {
      const user = await this.idp.getUser(record.sub);
      if (user?.email) return user.email;
    } catch (cause) {
      this.logger.warn(
        `admin enrollment label fell back to the login identifier: ${(cause as Error).message}`,
      );
    }
    return record.identifier || record.sub;
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
  ): Promise<AdminMfaVerifyOutcome> {
    return this.verifyFactor({
      ref,
      fingerprint,
      stage: "enrollment",
      step: "mfa_enrollment_required",
      check: async (record) => {
        const verified = await this.idp.verifyTotpRegistration(
          record.sub,
          code,
        );
        // The enrollment verify does not touch the Zitadel session, so the
        // pending record's proof-of-check token is still the live one.
        return verified ? record : undefined;
      },
      onVerified: (record) =>
        // EARS-5/EARS-9: the enrollment path's terminal factor row is
        // `auth.mfa.enrolled` — the same code both created the factor and proved
        // possession, so it does NOT also write `auth.mfa.used` (one terminal row
        // per lifecycle action, design §8a).
        this.audit.record({ type: "MfaEnrolled", sub: record.sub }),
    });
  }

  /**
   * EARS-6 — `VerifyMfaChallenge`. The second factor of every login after the
   * first: verify a TOTP code against the principal's **registered** factor and,
   * on success, complete the login in place (LD-1) exactly as the enrollment
   * verify does.
   *
   * The check runs at the IdP **against the checked Zitadel session this pending
   * authentication wraps** ({@link IdpClient.checkTotpFactor}), not against the
   * user's factor in isolation. That is what makes the resulting session
   * MFA-satisfied at the IdP too, rather than only in our own record — and it is
   * why the rotated session handle the check returns is threaded into the
   * upgrade: Zitadel invalidates the previous token on that update, so an upgrade
   * that reused the old one would fail the OIDC exchange *after* a correct code
   * and report a right code as wrong.
   *
   * **Single-use inside the window (EARS-6)** is enforced by the IdP-side factor
   * check (and mirrored by the fake's consumed-step ledger), not by a second
   * counter here — a replayed code is refused for the same reason a wrong one is,
   * and answers identically.
   *
   * Every refusal resolves `refused`; the pending authentication **survives** it,
   * so the operator retries on the challenge screen rather than being thrown back
   * to the login form.
   */
  async verifyChallenge(
    ref: string,
    fingerprint: string,
    code: string,
  ): Promise<AdminMfaVerifyOutcome> {
    return this.verifyFactor({
      ref,
      fingerprint,
      stage: "challenge",
      step: "mfa_challenge_required",
      check: async (record) => {
        const checked = await this.idp.checkTotpFactor(
          {
            zitadelSessionId: record.zitadelSessionId,
            sub: record.sub,
            sessionToken: record.sessionToken,
          },
          code,
        );
        // Carry the ROTATED proof-of-check into the upgrade (see the docblock).
        return checked
          ? { ...record, sessionToken: checked.sessionToken }
          : undefined;
      },
      onVerified: (record) =>
        this.audit.record({ type: "MfaChallengeSucceeded", sub: record.sub }),
    });
  }

  /**
   * EARS-7 — the **one** verification pipeline both TOTP surfaces run.
   *
   * The enrollment verify and the challenge verify differ in exactly two places:
   * which pending step they serve, and which IdP call proves possession. Every
   * other property EARS-7 mandates — the shared per-user budget, the shared
   * lockout counter, the failure row, the uniform refusal, the surviving pending
   * record — is identical, so it is written once here. Two copies of this
   * sequence would be two chances to drift, and the security-relevant drift
   * (a surface that counts nothing, or audits nothing) is invisible in a diff.
   *
   * Order is load-bearing:
   *
   * 1. **Resolve the pending record first.** An unresolvable reference has no
   *    subject, so it can consume no per-subject budget — otherwise a caller with
   *    a forged reference could exhaust a *stranger's* lockout counter and lock
   *    them out remotely. It is still audited (`no_pending`).
   * 2. **Rate limit before the lock check and before the IdP call**, so a
   *    throttled attempt costs neither an IdP round-trip nor a lockout unit.
   * 3. **Lock check before the code check.** A locked account's code is never
   *    verified at all, which is what makes "the lock beats a correct code"
   *    (design §6) structural rather than a branch after the verify.
   */
  private async verifyFactor(input: {
    ref: string;
    fingerprint: string;
    stage: AdminMfaStage;
    step: AdminNextStep;
    check: (
      record: PendingAuthRecord,
    ) => Promise<PendingAuthRecord | undefined>;
    onVerified: (record: PendingAuthRecord) => Promise<void>;
  }): Promise<AdminMfaVerifyOutcome> {
    const record = await this.getPendingForStep(
      input.ref,
      input.fingerprint,
      input.step,
    );
    if (!record) {
      await this.audit.record({
        type: "MfaChallengeFailed",
        sub: null,
        stage: input.stage,
        reason: "no_pending",
      });
      return { status: "refused" };
    }

    const outcome = await this.guardedTotpCheck({
      sub: record.sub,
      identifier: record.identifier,
      stage: input.stage,
      check: () => input.check(record),
    });
    if (outcome.status !== "verified") return outcome;

    await input.onVerified(outcome.proven);
    const upgraded = await this.completePending(
      outcome.proven,
      input.fingerprint,
    );
    if (!upgraded) return { status: "refused" };
    return { status: "verified", ...upgraded };
  }

  /**
   * EARS-7 — the **accounting envelope** every TOTP check in the admin tier runs
   * inside: the shared per-user rate window, the shared lockout counter, the
   * failure row, the uniform refusal, and the forgiveness a proven factor earns.
   *
   * It is separate from {@link verifyFactor} because EARS-13's factor-removal
   * proof needs exactly this envelope and none of the pending-authentication
   * machinery around it — its caller holds an established admin session, not a
   * pending reference. Writing the envelope twice is how "no separate attempt
   * budget" (EARS-13) silently becomes three parallel allowances, and that drift
   * is invisible in a diff.
   *
   * Order is load-bearing, and unchanged from the login surfaces:
   *
   * 1. **Rate limit before the lock check and before the IdP call**, so a
   *    throttled attempt costs neither an IdP round-trip nor a lockout unit. The
   *    guard's `@RateLimited()` pass already consumed the per-IP / per-ASN windows
   *    for this request but skipped the per-user one — the request bodies carry no
   *    identifier (see `tryConsumeUser`), so it is wired in explicitly here.
   * 2. **Lock check before the code check.** A locked account's code is never
   *    verified at all, which is what makes "the lock beats a correct code"
   *    (design §6) structural rather than a branch after the verify.
   */
  private async guardedTotpCheck<T>(input: {
    sub: string;
    identifier: string;
    stage: AdminMfaStage;
    check: () => Promise<T | undefined>;
  }): Promise<GuardedCheckOutcome<T>> {
    if (!this.limiter.tryConsumeUser(input.identifier)) {
      return { status: "throttled" };
    }

    if (this.lockout.isLocked(input.sub)) {
      await this.audit.record({
        type: "MfaChallengeFailed",
        sub: input.sub,
        stage: input.stage,
        reason: "locked",
      });
      return { status: "refused" };
    }

    const proven = await input.check();
    if (proven === undefined) {
      await this.recordVerifyFailure(input.sub, input.stage);
      return { status: "refused" };
    }

    // A proven factor ends the guessing this slice bounds: the lockout tally is
    // forgiven outright, and the per-user rate window with it (#222's rule — the
    // per-IP / per-ASN windows are deliberately NOT refunded, so a success cannot
    // buy back an origin's broader budget).
    this.lockout.clear(input.sub);
    this.limiter.reset({ ip: "", identifier: input.identifier });
    return { status: "verified", proven };
  }

  /**
   * EARS-13 — `RemoveMfaFactor`. The LD-2 operator recovery action: a
   * `platform_admin` removes ANOTHER admin's registered TOTP factor, and the
   * target's next login re-enters the forced-enrollment gate of EARS-4.
   *
   * **The protection is a route-local fresh-possession proof.** The caller
   * supplies their OWN current TOTP code, verified at call time against their own
   * registered factor. That realises ADR-0001 §10's policy intent — an MFA change
   * is elevated and demands fresh MFA — for this one route, by something that
   * actually runs: the general step-up mechanism (`StepUpGuard`, the
   * `acr=mfa-fresh` claim, the elevated session) has never been built here, so
   * declaring `step_up` metadata would make the endpoint-authz matrix advertise a
   * guard that does not exist (011 design §9).
   *
   * The proof runs inside {@link guardedTotpCheck}, so a wrong code draws on the
   * SAME per-user window and the SAME lockout counter the login verifies use, and
   * writes the same `auth.mfa.failure` row — discriminated by
   * `stage: "factor_removal"`. The endpoint is therefore not a code-guessing
   * oracle with a budget of its own (EARS-13).
   *
   * **Self-removal is refused**, first and before any budget is spent. In this
   * slice TOTP is the only factor kind, so a caller removing their own factor is
   * removing their own LAST factor — and they would walk straight back in through
   * forced enrollment, converting the recovery endpoint into an MFA opt-out
   * (design §9). The only path that removes a sole operator's factor is the LD-2
   * break-glass script, under its stated precondition.
   */
  async removeMfaFactor(
    caller: AdminSessionPrincipal,
    targetSub: string,
    code: string,
  ): Promise<AdminFactorRemovalOutcome> {
    if (targetSub === caller.sub) return { status: "self_removal" };

    // The identifier the §7 per-user window is keyed by travels on the session
    // record (carried over from the pending authentication), so this route counts
    // against the same budget primary auth and both verifies do. A session that
    // vanished between the hook and the handler resolves to the uniform refusal.
    const session = await this.sessions.get(caller.sid);
    if (!session) return { status: "refused" };
    // A record written before the identifier was carried onto the admin session
    // has nothing to key the §7 per-user window by — and an absent key is not a
    // free pass: it would either throw inside the limiter (a 500 on the recovery
    // route, which is how #1214 Mode (a) found this) or, worse, spend an
    // unbudgeted attempt. Refused with the SAME uniform failure every other
    // refusal returns, and self-healing: the operator's next login writes a
    // record that carries the identifier.
    if (!session.identifier) return { status: "refused" };

    const outcome = await this.guardedTotpCheck({
      sub: caller.sub,
      identifier: session.identifier,
      stage: "factor_removal",
      check: async () =>
        (await this.idp.checkTotpCode(caller.sub, code)) ? true : undefined,
    });
    if (outcome.status !== "verified") return outcome;

    // The target must be a principal the MFA mandate actually covers (#1214 Mode
    // (a)). `:id` is a raw IdP subject supplied by the caller, so without this
    // the LD-2 recovery endpoint is a general "delete this user's TOTP factor"
    // command over the whole IdP population — and the `auth.mfa.reset` row it
    // writes would assert an ADMIN factor reset for an account that never held
    // an admin factor, quietly corrupting the one ledger EARS-9 exists to keep
    // trustworthy. Checked AFTER the possession proof so the read costs an IdP
    // round-trip only for callers who have already proven their own factor.
    //
    // Refused with the uniform failure rather than a distinct 404/400: a
    // separate answer here would make the endpoint a role oracle over the user
    // population, readable by any operator with a valid code. No failure row is
    // written — nothing about the caller's factor failed.
    if (!requiresMfa(await this.idp.getProjectRoles(targetSub))) {
      return { status: "refused" };
    }

    await this.applyFactorRemoval(targetSub, caller.sub);
    return { status: "removed" };
  }

  /**
   * EARS-13 / LD-2 — the **one** writer of a factor removal: drop the factor at
   * the IdP, then append the canonical `auth.mfa.reset` row naming the acting
   * operator in `by_admin`.
   *
   * Both removal paths enter here — the endpoint above, after it has verified the
   * caller's own code, and the break-glass ops script, which cannot verify one
   * because its precondition is that no second operator holds a factor. That is
   * what makes the two rows **shape-identical** by construction rather than by
   * convention: a ledger reader cannot tell which path wrote a row, so the audit
   * trail of factor removals has no hole (011 design §10, LD-2).
   *
   * **Order is load-bearing.** The IdP call runs first and fails LOUD: an outage
   * throws {@link IdpUnavailableError} (→ 503) before any row is written, so the
   * ledger never asserts a recovery that did not happen. The reverse order would
   * leave an `auth.mfa.reset` row standing for a factor that is still registered —
   * strictly worse than the outage, because it is silent.
   */
  async applyFactorRemoval(targetSub: string, byAdmin: string): Promise<void> {
    await this.idp.removeTotpFactor(targetSub);
    await this.audit.record({
      type: "MfaFactorRemoved",
      sub: targetSub,
      byAdmin,
    });
  }

  /**
   * EARS-7 failure accounting, for BOTH verify surfaces: one `auth.mfa.failure`
   * row per refused attempt, one lockout unit, and — on the attempt that crosses
   * the threshold and on that one only — the `auth.lockout.triggered` row plus
   * the §7 notification.
   *
   * Before this slice the enrollment verify wrote no failure row from any source,
   * so "10 failed attempts" was a threshold with no evidence behind it: a
   * forensic reader could see an account lock with nothing explaining it.
   */
  private async recordVerifyFailure(
    sub: string,
    stage: AdminMfaStage,
  ): Promise<void> {
    const { justLocked } = this.lockout.recordFailure(sub);
    await this.audit.record({
      type: "MfaChallengeFailed",
      sub,
      stage,
      reason: "invalid",
    });
    if (!justLocked) return;
    await this.audit.record({ type: "LockoutTriggered", sub });
    // Fire-and-forget, exactly like the EARS-23 account-exists notice (the
    // subject is all this needs — the address is resolved from the IdP). The
    // response for the threshold-crossing attempt must land in the same ≤50 ms
    // band as every other failure (EARS-7), and an SMTP round-trip inside the
    // request would make attempt #10 measurably slower than attempts #1-9 — a
    // timing oracle for "this account just locked", built by the very code meant
    // to avoid one.
    void this.notifyLockout(sub);
  }

  /**
   * The §7 lockout notification. Resolves the address from the IdP (the identity
   * authority — `apps/api` holds no admin mailbox of its own) and sends the
   * secret-free notice.
   *
   * **Fail-soft and silent.** Neither a missing address nor a transport fault may
   * surface: this runs detached from a request whose answer is already decided,
   * and an unhandled rejection here would take down the process for a mail. The
   * lock itself is recorded in the ledger regardless, so the security event is
   * never lost with the mail.
   */
  private async notifyLockout(sub: string): Promise<void> {
    try {
      const user = await this.idp.getUser(sub);
      if (!user?.email) return;
      await this.mailer.sendAdminLockoutNotice(user.email);
    } catch (cause) {
      this.logger.warn(
        `admin lockout notice not delivered: ${(cause as Error).message}`,
      );
    }
  }

  /**
   * EARS-6 — `ReadAdminAuthState`. The single read the admin app routes on:
   * where does this browser belong — the login form, enrollment, challenge, or
   * the app itself?
   *
   * It answers with {@link AdminAuthState} and nothing else (design §9, Read
   * models). Every failure to resolve — no credential, an expired one, a
   * fingerprint that diverged, a session record that is gone — collapses into
   * `unauthenticated`: the caller has passed primary auth at most, which is
   * exactly the stolen-password attacker the second factor exists to stop, so a
   * diagnosis here would be the oracle the uniform-failure rule denies one route
   * over.
   *
   * The session is checked **before** the pending reference: an upgrade deletes
   * the pending record, but a stale `__Host-ds_admin_pending` can still be sitting
   * in the browser, and an established session must never read as "still owing a
   * factor".
   */
  async readState(input: {
    sid: string | undefined;
    pendingRef: string | undefined;
    fingerprint: string;
  }): Promise<AdminAuthState> {
    if (input.sid) {
      const session = await this.sessions.get(input.sid);
      if (
        session &&
        session.fingerprint === input.fingerprint &&
        session.mfa === true
      ) {
        return "active";
      }
    }
    if (input.pendingRef) {
      const record = await this.pending.get(input.pendingRef);
      if (record && record.fingerprint === input.fingerprint) {
        return record.nextStep === "mfa_challenge_required"
          ? "mfa_pending_challenge"
          : "mfa_pending_enrollment";
      }
    }
    return "unauthenticated";
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
    return this.completePending(record, fingerprint);
  }

  /**
   * The body of {@link upgradePending}, taking the **record** rather than its
   * reference.
   *
   * Split out because the challenge path (EARS-6) holds a record whose
   * `sessionToken` has been ROTATED by the IdP-side factor check and is therefore
   * newer than what the store holds — re-reading by `ref` there would fetch the
   * stale, already-invalidated token and fail the exchange after a correct code.
   * The store row is deleted by this method anyway, so writing the rotation back
   * only to read it once would be a round-trip with no reader.
   */
  private async completePending(
    record: PendingAuthRecord,
    fingerprint: string,
  ): Promise<
    { cookies: string[]; principal: AdminSessionPrincipal } | undefined
  > {
    const ref = record.ref;
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
      // Carried over so the EARS-13 route can count against the SAME §7 per-user
      // window primary auth keyed on (design §8 / EARS-7's shared budget).
      identifier: record.identifier,
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

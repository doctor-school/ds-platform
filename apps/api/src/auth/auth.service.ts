import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { consentRecords, users, type DrizzleHandle } from "@ds/db";
import type {
  OtpRequest,
  OtpRequestResponse,
  OtpVerify,
  PasswordResetCompleteResponse,
  PasswordResetResponse,
  RegisterRequest,
  RegisterResponse,
  VerifyRequest,
  VerifyResendResponse,
  VerifyResponse,
  ZitadelWebhook,
  ZitadelWebhookResponse,
} from "@ds/schemas";
import type { SessionClaims } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
  type IdpClient,
} from "./idp/idp.types.js";
import { AUTH_WEBHOOK_SECRET } from "./auth.tokens.js";
import { webhookSecretMatches } from "./webhook-secret.js";
import { UserMirrorService } from "./user-mirror.service.js";
import { SmsBudgetService } from "./sms-budget/sms-budget.service.js";
import { MAILER, type Mailer } from "../mailer/mailer.types.js";
import {
  REGISTER_NOTICE_THROTTLE,
  type RegisterNoticeThrottle,
} from "../mailer/register-notice-throttle.js";
import { AUTH_AUDIT, type AuthAuditLog } from "./session/auth-audit.types.js";
import {
  SessionService,
  type RefreshOutcome,
} from "./session/session.service.js";

type Db = DrizzleHandle["db"];

// One generic message for every register/verify failure. The specific reason
// (duplicate, bad code, missing consent) never reaches the client — it would be
// an enumeration / oracle channel (EARS-16); reasons live in the audit ledger
// (F6). Same string, same 400, for every failure branch.
const GENERIC_FAILURE = "the request could not be completed";

// EARS-14: one generic throttled message for every SMS-budget refusal (per-phone
// / per-IP / per-ASN ceiling or the global daily breaker). It names no threshold
// and no account — a refusal is not an existence oracle and not an attacker's
// budget read-out (design §10: breaker-open returns a generic "try later").
const GENERIC_THROTTLED = "too many requests, please try again later";

// #147: one generic, non-enumerating message for a residual IdP password-policy
// rejection (the creation schema passed but a live Zitadel stricter than the
// baseline 400'd inside createUser). It names the password requirement, NOT the
// account — the same 422 fires whether or not the identifier exists (a duplicate
// is the 409 → `alreadyExisted` path and never reaches it), so it is not an
// existence oracle (EARS-16).
const GENERIC_WEAK_PASSWORD =
  "the password does not meet the security requirements";

// #202: one message for a genuine IdP infra fault (5xx / network) on the
// registration path. Per the project's actionable-errors rule (5xx/net →
// "unavailable") this is a 503, distinct from the deterministic-rejection generic
// 4xx — a real outage is reported honestly, but never as a bare unhandled 500.
const GENERIC_UNAVAILABLE = "the service is temporarily unavailable";

/** Postgres unique-constraint violation SQLSTATE (`unique_violation`). */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * True when the error is a Postgres unique-constraint violation. node-postgres
 * sets `.code` on the error, but drizzle wraps it (e.g. `DrizzleQueryError`)
 * with the pg error on `.cause`, so walk the cause chain.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (
      typeof e === "object" &&
      (e as { code?: unknown }).code === PG_UNIQUE_VIOLATION
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * BFF auth orchestration for F1 (#85): registration cascade (EARS-1/2), the
 * consent gate (EARS-20), verification (EARS-3/4), and webhook mirror sync
 * (EARS-19). Every credential operation is delegated to the {@link IdpClient}
 * port — this service never hashes a password, generates a code, or verifies
 * one itself (Constraints; design §2).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Constructor ordering note: the `@Inject(...)` params come first and the
  // type-inferred `UserMirrorService` last. tsx/esbuild (used by the
  // endpoint-authz lint gate) mis-emits `design:paramtypes` when a type-inferred
  // parameter precedes an `@Inject` one, so a type-inferred dependency must be
  // last — see AuthController for the same constraint.
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(AUTH_WEBHOOK_SECRET)
    private readonly webhookSecret: string | undefined,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
    // EARS-23 (#207): the BFF transactional-email channel + per-address throttle
    // for the account-exists notice. Both are `@Inject`-token params, so they
    // precede the type-inferred class deps below (the tsx/esbuild
    // `design:paramtypes` ordering hazard above).
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(REGISTER_NOTICE_THROTTLE)
    private readonly noticeThrottle: RegisterNoticeThrottle,
    private readonly mirror: UserMirrorService,
    private readonly sessions: SessionService,
    private readonly smsBudget: SmsBudgetService,
  ) {}

  /**
   * EARS-5: password login. Delegates the credential check to the IdP port
   * (which is where the native Zitadel lockout counter increments on failure,
   * EARS-15) and, on success, establishes the BFF session (EARS-8). Returns
   * `null` for every failure — unknown identifier and wrong password are
   * indistinguishable so the controller responds enumeration-resistantly
   * (EARS-16). The `fingerprint` is computed by the controller from the request
   * (the only request-coupled input) and bound into the session here.
   */
  async loginWithPassword(
    identifier: string,
    password: string,
    fingerprint: string,
  ): Promise<{ cookie: string; claims: SessionClaims } | null> {
    const result = await this.idp.passwordLogin(identifier, password);

    // EARS-15: observe the native lockout verdict. The terminal failure event is
    // `auth.login.failure` (reason `lock`); the state-transition `lockout.triggered`
    // fires exactly once, on the attempt that tripped it. Both stay enumeration-safe
    // — the controller still answers the same generic 401 (`null`) as a rejection.
    if (result.outcome === "locked") {
      await this.audit.record({
        type: "LoginFailed",
        identifier,
        reason: "lock",
      });
      if (result.justLocked) {
        await this.audit.record({ type: "AccountLocked", sub: result.sub });
      }
      return null;
    }
    if (result.outcome === "rejected") {
      // EARS-18: `auth.login.failure` (reason `wrong_password`) — unknown
      // identifier and wrong password are one indistinguishable reason here.
      await this.audit.record({
        type: "LoginFailed",
        identifier,
        reason: "wrong_password",
      });
      return null;
    }

    const established = await this.sessions.establish(
      result.session.zitadelSessionId,
      fingerprint,
    );
    await this.audit.record({
      type: "LoginSucceeded",
      sub: result.session.sub,
      method: "password",
    });
    return established;
  }

  /**
   * EARS-6/7 step 1: request a passwordless login code. Email delegates straight
   * to the IdP's native `otp_email` send. SMS first passes the EARS-14 toll-fraud
   * budget (per-phone/IP/ASN + global daily breaker): a refused send reaches
   * neither Zitadel nor the user — it returns a generic throttled error (design
   * §10), so no SMS costs money and the refusal leaks nothing. Both channels'
   * success is the same enumeration-safe `otp_sent` acknowledgement (EARS-16) —
   * the IdP send resolves identically whether or not the identifier exists.
   * `ctx` carries the request-coupled SMS-budget dimensions (the controller is the
   * only layer with the IP and the edge-supplied ASN).
   */
  async requestLoginOtp(
    req: OtpRequest,
    ctx: { ip: string; asn?: string | undefined },
  ): Promise<OtpRequestResponse> {
    if (req.channel === "email") {
      await this.idp.requestEmailOtp(req.identifier);
    } else {
      const allowed = this.smsBudget.tryConsume({
        phone: req.identifier,
        ip: ctx.ip,
        asn: ctx.asn,
      });
      if (!allowed) {
        throw new HttpException(
          GENERIC_THROTTLED,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.idp.requestSmsOtp(req.identifier);
    }
    // EARS-18: `auth.otp.sent` (identifier masked). A budget-refused SMS threw
    // above and never reaches here, so a row exists only for an actual send.
    await this.audit.record({
      type: "OtpSent",
      identifier: req.identifier,
      channel: req.channel,
    });
    return { status: "otp_sent" };
  }

  /**
   * EARS-6/7 step 2: verify a passwordless login code and, on success, establish
   * the BFF session (EARS-8) — the identical convergence point as password login
   * (design §6), so the cookie/token logic exists once. Returns `null` for every
   * failure (unknown identifier, wrong/expired code) so the controller answers
   * with the same generic 401 (EARS-16). The `fingerprint` is computed by the
   * controller from the request and bound into the session here.
   */
  async loginWithOtp(
    req: OtpVerify,
    fingerprint: string,
  ): Promise<{ cookie: string; claims: SessionClaims } | null> {
    const session =
      req.channel === "email"
        ? await this.idp.loginWithEmailOtp(req.identifier, req.code)
        : await this.idp.loginWithSmsOtp(req.identifier, req.code);
    if (!session) {
      // EARS-18: a wrong/expired code (or unknown identifier) is one generic
      // `auth.login.failure`; the controller still answers the same 401 (EARS-16).
      await this.audit.record({
        type: "LoginFailed",
        identifier: req.identifier,
        reason: "wrong_password",
      });
      return null;
    }
    const established = await this.sessions.establish(
      session.zitadelSessionId,
      fingerprint,
    );
    await this.audit.record({
      type: "LoginSucceeded",
      sub: session.sub,
      method: req.channel === "email" ? "email-otp" : "sms-otp",
    });
    return established;
  }

  /**
   * EARS-9: rotate the BFF session's refresh token single-use (delegates to the
   * session layer, which owns the IdP exchange + reuse handling). Thin pass-through
   * mirroring `loginWithPassword` — the controller layer holds the cookie/HTTP.
   */
  refreshSession(sid: string): Promise<RefreshOutcome> {
    return this.sessions.refresh(sid);
  }

  /** EARS-10: revoke the BFF session and return the cookie that clears it. */
  logout(sid: string): Promise<{ cookie: string }> {
    return this.sessions.logout(sid);
  }

  /**
   * EARS-11: initiate a password reset. Delegates to the IdP's forgot-password
   * code flow and returns the same `reset_requested` acknowledgement no matter
   * whether the identifier exists — the port resolves identically either way, so
   * the response discloses nothing (enumeration-resistant, EARS-16). Timing
   * equalization across the existing/unknown paths (EARS-16's ≤50 ms budget) is
   * the cross-cutting concern owned by F6 (#90).
   */
  async requestPasswordReset(
    identifier: string,
  ): Promise<PasswordResetResponse> {
    await this.idp.requestPasswordReset(identifier);
    // EARS-18: `auth.password.reset_requested` (identifier masked; no subject —
    // resolving one would itself be an existence oracle, EARS-16).
    await this.audit.record({ type: "PasswordResetRequested", identifier });
    return { status: "reset_requested" };
  }

  /**
   * EARS-12: complete a password reset and auto-log-in the subject (#221). The IdP
   * sets the new password against the reset code and returns a checked session
   * (design §2). On success the BFF (1) revokes every PRIOR session of that subject
   * (global force-logout) and records `PasswordResetCompleted` — owned by the
   * session layer — then (2) mints a FRESH authenticated session from the checked
   * IdP session, exactly as the login path does (design §6 convergence: the same
   * `sessions.establish` hop + the same session-created `LoginSucceeded` audit
   * row). The response body stays token-free (EARS-8) — the new `__Host-` session
   * cookie is returned for the controller to set. An invalid/expired code or
   * unknown identifier is the same generic failure (EARS-16); the specific reason
   * lives only in the audit ledger (F6). The `fingerprint` is computed by the
   * controller from the request (the only request-coupled input) and bound into
   * the new session here, mirroring `loginWithPassword`.
   */
  async completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
    fingerprint: string,
  ): Promise<{ cookie: string; body: PasswordResetCompleteResponse }> {
    const session = await this.idp.completePasswordReset(
      identifier,
      code,
      newPassword,
    );
    if (!session) throw new BadRequestException(GENERIC_FAILURE);
    // Global force-logout of every PRIOR session (+ the PasswordResetCompleted
    // audit) BEFORE minting the new one, so the credential change leaves no stale
    // session behind and the fresh session is the only survivor.
    await this.sessions.revokeAllForSub(session.sub);
    // Mint the fresh session on the identical login convergence point (EARS-8).
    const established = await this.sessions.establish(
      session.zitadelSessionId,
      fingerprint,
    );
    // Mirror login's session-created audit row (EARS-18): the reset just minted an
    // authenticated session, so it records the same `LoginSucceeded` (method
    // `password`) login does — in addition to the PasswordResetCompleted above.
    await this.audit.record({
      type: "LoginSucceeded",
      sub: session.sub,
      method: "password",
    });
    return { cookie: established.cookie, body: { status: "reset_completed" } };
  }

  /**
   * EARS-1: email-primary registration (#202). Email is the sole registration
   * identifier — Zitadel cannot create a login-capable human without one — so the
   * dual-identifier phone-register branch (and its EARS-14 register-time SMS-budget
   * gate) is gone; `SmsBudgetService` still gates the SMS-OTP *login* send. Phone is
   * a future post-registration secondary identifier. Consent-gated (EARS-20) and
   * enumeration-resistant (EARS-16): an already-registered email produces the
   * identical response with no duplicate account and no consent row.
   */
  async register(req: RegisterRequest): Promise<RegisterResponse> {
    // EARS-20: refuse before any IdP side-effect or PD row exists.
    if (req.consent.length === 0) {
      throw new BadRequestException(GENERIC_FAILURE);
    }

    let created;
    try {
      created = await this.idp.createUser({
        email: req.email,
        password: req.password,
      });
    } catch (err) {
      // #147 residual race: the creation schema (@ds/schemas NewPassword) mirrors
      // the deployed Zitadel default complexity policy, so a baseline-violating
      // password is already rejected at the DTO layer — uniformly, before this
      // call, independent of whether the account exists (no oracle). If a *live*
      // Zitadel configured stricter than baseline rejects the password here, the
      // adapter raises IdpPasswordPolicyError; map it to a generic, non-enumerating
      // "weak password" 422 — identical regardless of account existence. A *valid*
      // duplicate is the 409 → `alreadyExisted` path that never throws.
      if (err instanceof IdpPasswordPolicyError) {
        throw new UnprocessableEntityException(GENERIC_WEAK_PASSWORD);
      }
      // #202 robustness fix: a deterministic IdP 4xx `invalid_argument` (any other
      // bad request the IdP refuses before creating anything) must NOT surface as a
      // bare 500. Map it to the same generic, enumeration-safe failure used
      // elsewhere (a 4xx, NOT an existence oracle, EARS-16) — same precedent as the
      // password-policy mapping above.
      if (err instanceof IdpInvalidArgumentError) {
        throw new BadRequestException(GENERIC_FAILURE);
      }
      // A genuine infra fault (5xx / network) is a 503 "unavailable" (the
      // actionable-errors rule: 5xx/net → "unavailable"), distinct from the
      // deterministic 4xx above — honest about an outage, still never a 500.
      if (err instanceof IdpUnavailableError) {
        throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);
      }
      throw err;
    }

    // EARS-16: existing identifier — respond identically, create nothing.
    if (!created.alreadyExisted) {
      // Consent-before-PD invariant (EARS-20): the mirror row and its consent
      // records commit atomically, so no PD-bearing row can exist without
      // consent even under a mid-write failure.
      try {
        await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(users)
            .values({
              zitadelSub: created.sub,
              email: req.email,
              role: "doctor_guest",
            })
            .onConflictDoUpdate({
              target: users.zitadelSub,
              set: { updatedAt: new Date() },
            })
            .returning({ id: users.id });

          // The insert always yields a row (new sub, or the conflict update);
          // the guard satisfies the type and would catch a silent no-op.
          if (!row) throw new Error("mirror upsert returned no row");

          await tx.insert(consentRecords).values(
            req.consent.map((c) => ({
              userId: row.id,
              purpose: c.purpose,
              version: c.version,
            })),
          );
        });
      } catch (err) {
        // A unique-constraint violation here means the identifier already
        // exists under a *different* zitadel_sub (mirror↔IdP divergence: the
        // IdP reported a new user, our mirror disagrees). The onConflict target
        // is zitadel_sub, so an email/phone collision is not absorbed and would
        // surface as a 500 — a distinguishable signal. Map it to the same
        // generic failure so the response stays enumeration-safe (EARS-16); the
        // reconciliation sweep (EARS-19) is the path that heals the divergence.
        if (isUniqueViolation(err)) {
          throw new BadRequestException(GENERIC_FAILURE);
        }
        throw err;
      }

      // #157: authorize the new user for the `doctor_guest` project role in
      // Zitadel — the OIDC token's project-roles claim is the authz source the
      // guard reads (ADR-0001; the `users.role` mirror written above is a
      // downstream projection, NOT the authz authority). Without this grant a
      // registered+verified user gets 403 on every protected route (empty roles
      // claim). Awaited and NOT swallowed: in the live portal flow nothing else
      // heals it (the Action webhook is #119, the sweep unscheduled), so the grant
      // must be reliable here. A grant failure is infra, not existence-correlated,
      // so letting it surface preserves enumeration-safety (EARS-16) — the success
      // path still returns the identical always-`pending_verification` response.
      await this.idp.grantProjectRole(created.sub, DOCTOR_GUEST_ROLE);

      // #202: registration is email-only — trigger the Zitadel email verification
      // code (unmetered, no SMS). Phone verification is a future post-registration
      // secondary-identifier concern, so there is no register-time SMS send and no
      // EARS-14 budget gate here (the budget still gates the SMS-OTP login send).
      await this.idp.requestEmailVerification(created.sub);

      // EARS-18: one terminal `auth.register` row for the created account. The
      // accepted consent versions (EARS-20, not PD) ride in the metadata rather
      // than a separate `consent.captured` row (one terminal entry per command;
      // the standalone consent event is the ADR-0009 subsystem's, not 003's). The
      // already-existed path creates nothing and audits nothing — its response is
      // identical (EARS-16), but no account was registered, so no row is owed.
      await this.audit.record({
        type: "Registered",
        sub: created.sub,
        channel: "email",
        consent: req.consent.map((c) => ({
          purpose: c.purpose,
          version: c.version,
        })),
      });
    } else {
      // EARS-23 (#207): the email is already registered. The form must NOT
      // disclose this (that is precisely the oracle EARS-16 protects), so the
      // legitimate owner's correct path is delivered PRIVATELY — an
      // account-exists notice email (sign-in / reset prompt, no code/token/PD).
      // The branch otherwise stays unchanged: no account, no consent row, no
      // `auth.register` ledger entry (a duplicate registers nothing).
      void this.dispatchAccountExistsNotice(req.email);
    }

    return { status: "pending_verification" };
  }

  /**
   * EARS-23 (#207): dispatch the account-exists notice for an already-registered
   * register, fire-and-forget. NOT awaited on the response path — so SMTP latency
   * can never leak past the EARS-16 timing floor (a provider outage cannot stall
   * or differentiate the response). Per-address throttled (an ephemeral,
   * HMAC-keyed Redis marker, short TTL) so the form cannot flood a victim's
   * inbox: only the first send within the window goes out. Every failure (throttle
   * or send) is logged only and swallowed — it never throws and never alters the
   * `pending_verification` response.
   */
  private async dispatchAccountExistsNotice(email: string): Promise<void> {
    try {
      const allowed = await this.noticeThrottle.tryAcquire(email);
      if (!allowed) return;
      await this.mailer.sendAccountExistsNotice(email);
    } catch (err) {
      // Logged only — the duplicate-register response is already returned and
      // must stay identical to the never-registered case (EARS-16).
      this.logger.warn(
        `account-exists notice dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * EARS-3: verify the registration email OTP code and flip `email_verified`.
   * Registration verification is email-only (#202 — registration is
   * email-primary); EARS-4 phone verification is a future post-registration
   * secondary-identifier concern, so there is no phone branch here.
   */
  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    const row = await this.mirror.findByEmail(req.email);
    if (!row) throw new BadRequestException(GENERIC_FAILURE);

    const ok = await this.idp.verifyEmail(row.zitadelSub, req.code);
    if (!ok) throw new BadRequestException(GENERIC_FAILURE);

    await this.mirror.markEmailVerified(row.zitadelSub);

    // EARS-18: one terminal `auth.account.verified` row for this state-changing
    // command (the mirror flag just flipped — the account is activated). Keyed
    // by the opaque subject; the writer carries no raw PD. A FAILED verify (no
    // mirror row, or a bad/expired code) changes no state and completes no
    // command, so it emits nothing — consistent with the generic-failure /
    // EARS-16 enumeration-safe path above and EARS-18's "per state-changing
    // command" invariant.
    await this.audit.record({
      type: "IdentifierVerified",
      sub: row.zitadelSub,
      channel: "email",
    });

    return { status: "verified" };
  }

  /**
   * EARS-25: resend the registration email verification code, enumeration-safely.
   * The existence-agnostic `/verify` screen (EARS-24) needs a way to re-send the
   * code without the held password (re-`register` is the EARS-23 path and needs
   * it). Delegates to the IdP port's enumeration-safe
   * {@link IdpClient.resendEmailVerification} — keyed by the identifier, resolving
   * → `sub` internally and re-issuing the `otp_email` code ONLY for an existing,
   * UNVERIFIED registrant (an unknown identifier or an already-verified one is a
   * silent no-op). The port never throws or branches on existence, so the response
   * (`resend_requested`), status, and timing are identical on every path
   * (EARS-16; the ≤50 ms budget is the F6 `@TimingEqualized` concern). It creates
   * no `users`/consent row and appends the `otp.sent` ledger row (EARS-18) ONLY
   * when a code was actually issued (the port returns `true`) — the no-op paths
   * write nothing, so the ledger is not itself an existence oracle.
   */
  async resendEmailVerification(
    identifier: string,
  ): Promise<VerifyResendResponse> {
    const issued = await this.idp.resendEmailVerification(identifier);
    // EARS-18: `auth.otp.sent` (identifier masked, channel email) — written ONLY
    // when a real code was re-issued. An unknown / already-verified identifier
    // issued nothing, so no row exists for it: the ledger discloses no existence.
    if (issued) {
      await this.audit.record({
        type: "OtpSent",
        identifier,
        channel: "email",
      });
    }
    return { status: "resend_requested" };
  }

  /**
   * EARS-19: upsert the mirror row from a Zitadel Action webhook payload after
   * authenticating the caller with the shared secret. Fails closed — an unset
   * secret rejects every call (the mirror-write surface is never open by
   * default); a present secret must match exactly. The match is a **constant-time**
   * compare (`webhookSecretMatches` → `crypto.timingSafeEqual`, #119 (b),
   * design §11): a plain `!==` leaked timing proportional to the matching prefix,
   * a side-channel that recovers the secret byte-by-byte.
   */
  async syncFromWebhook(
    providedSecret: string | undefined,
    payload: ZitadelWebhook,
  ): Promise<ZitadelWebhookResponse> {
    if (!webhookSecretMatches(providedSecret, this.webhookSecret)) {
      throw new UnauthorizedException("invalid webhook secret");
    }
    await this.mirror.upsert(payload);
    // #157: idempotently (re)grant the `doctor_guest` project role on every
    // webhook — the authoritative sync trigger (EARS-19) backstops the register
    // grant, so a user whose register-time grant failed (or who Zitadel created
    // out-of-band) is authorized once the webhook lands. Idempotent: an
    // already-granted role is a no-op (the adapter treats ALREADY_EXISTS as
    // success).
    await this.idp.grantProjectRole(payload.zitadelSub, DOCTOR_GUEST_ROLE);
    return { status: "synced" };
  }
}

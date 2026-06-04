import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
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
  VerifyResponse,
  ZitadelWebhook,
  ZitadelWebhookResponse,
} from "@ds/schemas";
import type { SessionClaims } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { IDP_CLIENT, type IdpClient } from "./idp/idp.types.js";
import { AUTH_WEBHOOK_SECRET } from "./auth.tokens.js";
import { UserMirrorService } from "./user-mirror.service.js";
import { SmsBudgetService } from "./sms-budget/sms-budget.service.js";
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
    const session = await this.idp.passwordLogin(identifier, password);
    if (!session) return null;
    return this.sessions.establish(session.zitadelSessionId, fingerprint);
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
    if (!session) return null;
    return this.sessions.establish(session.zitadelSessionId, fingerprint);
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
  async requestPasswordReset(identifier: string): Promise<PasswordResetResponse> {
    await this.idp.requestPasswordReset(identifier);
    return { status: "reset_requested" };
  }

  /**
   * EARS-12: complete a password reset. The IdP sets the new password against the
   * reset code (design §2); on success every existing session of that subject is
   * revoked (global force-logout) and `PasswordResetCompleted` is recorded — both
   * owned by the session layer. An invalid/expired code or unknown identifier is
   * the same generic failure (EARS-16); the specific reason lives only in the
   * audit ledger (F6).
   */
  async completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<PasswordResetCompleteResponse> {
    const result = await this.idp.completePasswordReset(
      identifier,
      code,
      newPassword,
    );
    if (!result) throw new BadRequestException(GENERIC_FAILURE);
    await this.sessions.revokeAllForSub(result.sub);
    return { status: "reset_completed" };
  }

  /**
   * EARS-1 (email) / EARS-2 (phone). Consent-gated (EARS-20) and
   * enumeration-resistant (EARS-16): an already-registered identifier produces
   * the identical response with no duplicate account and no consent row.
   */
  async register(req: RegisterRequest): Promise<RegisterResponse> {
    // EARS-20: refuse before any IdP side-effect or PD row exists.
    if (req.consent.length === 0) {
      throw new BadRequestException(GENERIC_FAILURE);
    }

    const created = await this.idp.createUser({
      email: req.email,
      phone: req.phone,
      password: req.password,
    });

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
              phone: req.phone,
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

      // Trigger the Zitadel verification code for the registered channel.
      if (req.email) await this.idp.requestEmailVerification(created.sub);
      else await this.idp.requestPhoneVerification(created.sub);
    }

    return { status: "pending_verification" };
  }

  /** EARS-3 (email) / EARS-4 (phone): verify the OTP code and flip the mirror flag. */
  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    const row = req.email
      ? await this.mirror.findByEmail(req.email)
      : await this.mirror.findByPhone(req.phone as string);
    if (!row) throw new BadRequestException(GENERIC_FAILURE);

    const ok = req.email
      ? await this.idp.verifyEmail(row.zitadelSub, req.code)
      : await this.idp.verifyPhone(row.zitadelSub, req.code);
    if (!ok) throw new BadRequestException(GENERIC_FAILURE);

    if (req.email) await this.mirror.markEmailVerified(row.zitadelSub);
    else await this.mirror.markPhoneVerified(row.zitadelSub);

    return { status: "verified" };
  }

  /**
   * EARS-19: upsert the mirror row from a Zitadel Action webhook payload after
   * authenticating the caller with the shared secret. Fails closed — an unset
   * secret rejects every call (the mirror-write surface is never open by
   * default); a present secret must match exactly.
   */
  async syncFromWebhook(
    providedSecret: string | undefined,
    payload: ZitadelWebhook,
  ): Promise<ZitadelWebhookResponse> {
    if (!this.webhookSecret || providedSecret !== this.webhookSecret) {
      throw new UnauthorizedException("invalid webhook secret");
    }
    await this.mirror.upsert(payload);
    return { status: "synced" };
  }
}

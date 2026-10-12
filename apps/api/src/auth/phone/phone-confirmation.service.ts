import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  normalisePhoneEntry,
  type ConfirmPhoneResponse,
  type RequestPhoneCodeResponse,
} from "@ds/schemas";
import { IDP_CLIENT, type IdpClient } from "../idp/idp.types.js";
import { AUTH_AUDIT, type AuthAuditLog } from "../session/auth-audit.types.js";
import { MAILER, type Mailer } from "../../mailer/mailer.types.js";
import {
  SYNTHETIC_SUPPRESSION,
  type SyntheticSuppression,
} from "../../mailer/synthetic-suppression.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { SmsBudgetService } from "../sms-budget/sms-budget.service.js";
import {
  GENERIC_FAILURE,
  GENERIC_THROTTLED,
  GENERIC_UNAVAILABLE,
  issuedCode,
} from "../auth.service.js";
import {
  PHONE_MIRROR,
  type PhoneAccount,
  type PhoneMirror,
} from "./phone-mirror.js";

/** The request-coupled inputs of an SMS send (EARS-14). */
export interface PhoneRequestContext {
  ip: string;
  asn?: string | undefined;
}

/**
 * The EARS-13 per-account window key of the phone confirmation. Keyed by the
 * session subject (the surface is authenticated and takes no identifier), and
 * prefixed so it never collides with an email/phone sign-in identifier.
 */
export function phoneAccountLimitKey(sub: string): string {
  return `account:${sub}`;
}

/** EARS-48: the bounded re-read of an IdP user lagging an accepted code. */
const VERIFIED_READ_ATTEMPTS = 3;
const VERIFIED_READ_INTERVAL_MS = 100;

const throttled = (): HttpException =>
  new HttpException(GENERIC_THROTTLED, HttpStatus.TOO_MANY_REQUESTS);

/**
 * 003 EARS-47…52, 57 (#2449): confirming a phone from `/account`.
 *
 * The IdP generates, sends, expires, attempt-counts and verifies the code
 * (Zitadel `POST /v2/users/{id}/phone`, `/phone/resend`, `/phone/verify`); the
 * BFF keeps no pending record. `users.phone` is written only after the IdP
 * reports the number verified (EARS-48), and cleared when a request displaces
 * a previously confirmed number (EARS-47/49).
 *
 * EARS-51 (corrected 2026-10-12): a number already confirmed on ANOTHER account
 * is not refused — the request answers exactly like a free number (status,
 * body, timing under `@TimingEqualized`) and leaves the requester's own view
 * exactly as a free number would: a confirmed phone it held is displaced
 * (IdP + mirror), a number awaiting its code is dropped. It sends no SMS and
 * writes the taken number nowhere, so the surface is no oracle of which
 * numbers are registered; the confirm that follows fails generically.
 */
@Injectable()
export class PhoneConfirmationService {
  private readonly logger = new Logger(PhoneConfirmationService.name);

  // `@Inject`-token params first, type-inferred class deps last (the
  // tsx/esbuild `design:paramtypes` ordering hazard, see AuthService).
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(PHONE_MIRROR) private readonly mirror: PhoneMirror,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(SYNTHETIC_SUPPRESSION)
    private readonly synthetic: SyntheticSuppression,
    private readonly rateLimit: RateLimitService,
    private readonly smsBudget: SmsBudgetService,
  ) {}

  /** EARS-47 (+49 change, 51 elsewhere): request or re-send a code. */
  async requestCode(
    sub: string,
    typed: string,
    ctx: PhoneRequestContext,
  ): Promise<RequestPhoneCodeResponse> {
    if (!this.rateLimit.tryConsumeUser(phoneAccountLimitKey(sub))) {
      throw throttled();
    }
    const phone = normalisePhoneEntry(typed);
    const account = await this.mirror.account(sub);
    if (!account) throw new UnauthorizedException("authentication required");

    // A number the account already holds confirmed: a no-op success, no SMS,
    // no displacement (EARS-47).
    if (account.phoneVerified && account.phone === phone) {
      return { status: "already_confirmed" };
    }

    // EARS-14: every SMS of this surface — and the request that pretends to
    // send one (EARS-51) — passes the per-phone / per-IP / per-ASN limits and
    // the global budget, so the elsewhere-confirmed branch spends the same.
    if (!this.smsBudget.tryConsume({ phone, ip: ctx.ip, asn: ctx.asn })) {
      throw throttled();
    }

    const idpUser = await this.idp.getUser(sub);
    if (!idpUser) throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);

    const owner = await this.mirror.confirmedOwner(phone);
    if (owner !== null && owner !== sub) {
      // EARS-51: the same answer and the same own-view side effects as a free
      // number — the requester's phone is dropped at the IdP and displaced on
      // the mirror — but no SMS, and the taken number is written nowhere.
      if (idpUser.phone) await this.dropIdpPhone(sub);
      await this.displaceConfirmed(sub, account);
      return { status: "code_sent" };
    }

    if (idpUser.phone === phone && idpUser.phoneVerified) {
      // The IdP already holds it verified (the mirror lagged): heal the mirror.
      const written = await this.mirror.setConfirmedPhone(sub, phone);
      return written === "written"
        ? { status: "already_confirmed" }
        : { status: "code_sent" };
    }

    const suppressed = this.synthetic.suppress("sms", phone);
    try {
      if (idpUser.phone === phone) {
        // The number awaits its code already: a resend.
        if (!suppressed) await this.idp.requestPhoneVerification(sub);
      } else {
        await this.idp.setPhone(sub, phone, suppressed ? "none" : "sms");
      }
    } catch (err) {
      this.logger.warn(
        `phone code request failed at the IdP: ${(err as Error).name}`,
      );
      throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);
    }

    // EARS-47/49 displacement: the IdP no longer holds the old number
    // verified, so the mirror stops calling it confirmed in this request.
    await this.displaceConfirmed(sub, account);
    await this.audit.record({ type: "PhoneConfirmRequested", sub });
    return { status: "code_sent" };
  }

  /** EARS-47/49/51: the mirror stops holding a displaced confirmed phone. */
  private async displaceConfirmed(
    sub: string,
    account: PhoneAccount,
  ): Promise<void> {
    if (account.phoneVerified && account.phone !== null) {
      await this.mirror.clearConfirmedPhone(sub);
      await this.audit.record({ type: "PhoneChanged", sub });
    }
  }

  /** Drop the IdP user's phone; an IdP failure is the generic unavailable. */
  private async dropIdpPhone(sub: string): Promise<void> {
    try {
      await this.idp.removePhone(sub);
    } catch (err) {
      this.logger.warn(
        `phone removal failed at the IdP: ${(err as Error).name}`,
      );
      throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);
    }
  }

  /**
   * EARS-48: whether the IdP user holds `phone` verified after an accepted
   * code. The user read can lag the verify (Zitadel projections), so an
   * unverified read of the SAME number is re-read a bounded few times; a
   * different or absent number is a definite no.
   */
  private async idpHoldsVerified(sub: string, phone: string): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
      const after = await this.idp.getUser(sub);
      if (!after) throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);
      if (after.phone !== phone) return false;
      if (after.phoneVerified) return true;
      if (attempt >= VERIFIED_READ_ATTEMPTS) return false;
      await new Promise((resolve) =>
        setTimeout(resolve, VERIFIED_READ_INTERVAL_MS),
      );
    }
  }

  /** EARS-48: confirm the code; on success write the confirmed phone. */
  async confirm(sub: string, code: string): Promise<ConfirmPhoneResponse> {
    const key = phoneAccountLimitKey(sub);
    if (!this.rateLimit.tryConsumeUser(key)) throw throttled();

    const submitted = issuedCode(code);
    if (submitted === null) throw new BadRequestException(GENERIC_FAILURE);
    const account = await this.mirror.account(sub);
    if (!account) throw new UnauthorizedException("authentication required");

    // EARS-48: the number the code was issued for is read BEFORE the verify and
    // must still be the IdP's phone, verified, AFTER it. A concurrent request
    // that sets another number before the verify invalidates the code; one that
    // lands after it changes the phone the re-read sees — both are refused, so
    // a number the IdP never verified is never written as confirmed.
    const before = await this.idp.getUser(sub);
    if (!before) throw new ServiceUnavailableException(GENERIC_UNAVAILABLE);

    const verified = await this.idp.verifyPhone(sub, submitted);
    if (!verified || !before.phone) {
      throw new BadRequestException(GENERIC_FAILURE);
    }
    const phone = before.phone;
    if (!(await this.idpHoldsVerified(sub, phone))) {
      throw new BadRequestException(GENERIC_FAILURE);
    }
    // EARS-48/51: losing the UNIQUE race to another account's earlier
    // confirmation writes nothing and answers like a wrong code — and the
    // number is dropped from this IdP user, so the IdP never holds a verified
    // number the mirror refused. Should that removal fail, the mirror sync
    // still treats the conflicting number as not confirmed (UserMirrorService).
    if ((await this.mirror.setConfirmedPhone(sub, phone)) === "taken") {
      await this.idp
        .removePhone(sub)
        .catch((err: unknown) =>
          this.logger.warn(
            `race-loser phone removal failed at the IdP: ${(err as Error).name}`,
          ),
        );
      throw new BadRequestException(GENERIC_FAILURE);
    }
    await this.audit.record({ type: "PhoneConfirmed", sub });
    // EARS-52: fire-and-forget; a mailer failure never alters the response.
    if (account.email) {
      this.mailer
        .sendPhoneConfirmedNotice(account.email, new Date())
        .catch((err: unknown) =>
          this.logger.warn(
            `phone-confirmed notice failed: ${(err as Error).name}`,
          ),
        );
    }
    return { status: "confirmed", phone };
  }
}

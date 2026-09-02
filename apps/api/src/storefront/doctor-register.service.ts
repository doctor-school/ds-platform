import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  ConsentAcceptance,
  DoctorRegisterRequest,
  DoctorRegisterResponse,
} from "@ds/schemas";
import {
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES,
} from "@ds/schemas";

import { AuthService } from "../auth/auth.service.js";

/**
 * The version stamped on the declaration when it is granted (ADR-0009 —
 * consents are per-purpose AND versioned; a bare boolean is not a consent
 * record). It is the version of the wording the doctor actually read, so it
 * changes when the canvas copy of the declaration changes, never silently.
 */
export const MEDICAL_WORKER_DECLARATION_VERSION = "2026-09";

/**
 * 021 `RegisterDoctor` — the doctor-storefront registration command (021 design
 * §2).
 *
 * **021 owns the surface; 003 owns the engine.** This service adds exactly what
 * the storefront door adds — the access-condition precondition — and then hands
 * credential creation to the shipped 003 registration path
 * ({@link AuthService.register}), which creates the Zitadel user, triggers the
 * verification code, writes the PD mirror row and commits the per-purpose
 * consent rows atomically. There is no second credential path, no second code
 * path and no second consent model here; a change that would move one of those
 * boxes into this file is a 003 increment, not a 021 requirement.
 *
 * ## Why a 021 command rather than a rule inside `POST /v1/auth/register`
 *
 * The medical-worker declaration is a precondition of *this door*, not of every
 * registration the platform accepts — the Academy portal reaches the same 003
 * engine and is not a 021 surface. Pushing the precondition into the shared
 * command would impose a doctor-storefront access condition on every consumer of
 * that engine; keeping the engine shared and the precondition local is what
 * makes this a thin host projection rather than a fork.
 */
@Injectable()
export class DoctorRegisterService {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * EARS-4. Refuses before ANY side-effect when the medical-worker declaration
   * is absent, then delegates the accepted registration to 003.
   */
  async register(req: DoctorRegisterRequest): Promise<DoctorRegisterResponse> {
    const consent = this.accessConditionConsents(req);

    // 021 design §4 — "Record when withheld → command refused". The schema's
    // `z.literal(true)` already rejects an explicit `false` at the I/O boundary
    // (a 400 before the handler runs); this guard is the DOMAIN statement of the
    // same rule, so the refusal survives any future caller that reaches the
    // service without the DTO pipe, and it is the single place the second
    // access condition (EARS-5, #1541) gets added.
    //
    // The `code` is specific here and generic on the 003 paths for a reason: it
    // describes the submitted request, not the account, and fires identically
    // for a registered and an unregistered email before the IdP is touched — so
    // 003 EARS-16 enumeration safety is untouched, while 021 EARS-12 gets the
    // field-actionable refusal it requires.
    const missing = REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES.filter(
      (purpose) => !consent.some((entry) => entry.purpose === purpose),
    );
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        code: MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
        message: "the medical-worker declaration is required",
        missingConsentPurposes: missing,
      });
    }

    // The 003 engine, unchanged. Its response is the enumeration-safe
    // `pending_verification` (EARS-16) that 021 EARS-13 requires this surface to
    // render identically for a known and an unknown email.
    return this.auth.register({
      email: req.email,
      password: req.password,
      consent,
      ...(req.captchaToken === undefined
        ? {}
        : { captchaToken: req.captchaToken }),
    });
  }

  /**
   * The purposes that go to the engine: the declaration derived from the
   * command's own flag, plus whatever else the caller granted.
   *
   * Deriving the declaration row from `medicalWorkerDeclaration` rather than
   * trusting the array is what keeps the flag and the record from ever
   * disagreeing — the checkbox the doctor ticked IS the row that is written.
   * EARS-7's "an ungranted optional purpose produces no record at all" holds by
   * construction: an ungranted purpose is simply absent from the array; there is
   * no `granted: false` shape to store.
   */
  private accessConditionConsents(
    req: DoctorRegisterRequest,
  ): ConsentAcceptance[] {
    const supplied = req.consent.filter(
      (entry) => entry.purpose !== MEDICAL_WORKER_DECLARATION_PURPOSE,
    );
    return req.medicalWorkerDeclaration
      ? [
          {
            purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
            version: MEDICAL_WORKER_DECLARATION_VERSION,
          },
          ...supplied,
        ]
      : supplied;
  }
}

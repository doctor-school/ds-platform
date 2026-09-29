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
  DOCTOR_REGISTER_CONSENT_PURPOSES,
  DOCTOR_REGISTER_CONSENT_REFUSAL_CODES,
  isDoctorRegisterConsentPurpose,
  MARKETING_COMMUNICATIONS_PURPOSE,
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  PARTNER_DATA_SHARING_PURPOSE,
  REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES,
} from "@ds/schemas";

import { AuthService } from "../auth/auth.service.js";

/**
 * The version stamped on the declaration when it is granted (ADR-0009 —
 * consents are per-purpose AND versioned; a bare boolean is not a consent
 * record). It is the version of the wording the doctor actually read, so it
 * changes when the canvas copy of the declaration changes, never silently —
 * and #2027 did not change it: the declaration's label, help line and unmet
 * reason are byte-identical to the ones this version was first stamped for.
 */
export const MEDICAL_WORKER_DECLARATION_VERSION = "2026-09";

/**
 * The version stamped on the partner-data consent (021 EARS-5). Same rule as
 * the declaration's: it is the version of the WORDING the doctor read — the
 * shared `@ds/auth-flow` consent row the door renders — so re-wording that row
 * moves this constant with it and the two never drift apart silently. #2027
 * moved the door onto the canvas wording; hence `2026-09-22`.
 *
 * Server-stamped rather than trusted from the payload: a client-supplied
 * version would let the recorded row claim a wording the surface never rendered.
 */
export const PARTNER_DATA_SHARING_VERSION = "2026-09-22";

/**
 * The version stamped on the marketing opt-in (021 EARS-6). Same server-stamp
 * rule as the two access conditions: presence of the purpose in the command is
 * the GRANT, the version is ours — it names the marketing wording the doctor
 * actually read on the storefront, so it changes when that copy changes and
 * never because a caller claimed a different one.
 *
 * It is a separate constant rather than a shared one because the three wordings
 * version independently: re-wording the marketing opt-in must not silently
 * restamp the access conditions the doctor accepted under the old text. #2027
 * re-worded the opt-in to the canvas alongside the partner-data row, so both
 * moved to `2026-09-22` while the untouched declaration stayed behind.
 */
export const MARKETING_COMMUNICATIONS_VERSION = "2026-09-22";

/**
 * The wording version this server stamps on each declared purpose (021 EARS-7).
 *
 * Typed against the contract's closed purpose list, so adding a purpose to
 * `DOCTOR_REGISTER_CONSENT_PURPOSES` without deciding which wording version its
 * rows carry is a compile error rather than a row that quietly inherits a
 * caller's claim.
 */
const SERVER_STAMPED_CONSENT_VERSIONS: Record<
  (typeof DOCTOR_REGISTER_CONSENT_PURPOSES)[number],
  string
> = {
  [MEDICAL_WORKER_DECLARATION_PURPOSE]: MEDICAL_WORKER_DECLARATION_VERSION,
  [PARTNER_DATA_SHARING_PURPOSE]: PARTNER_DATA_SHARING_VERSION,
  [MARKETING_COMMUNICATIONS_PURPOSE]: MARKETING_COMMUNICATIONS_VERSION,
};

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
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

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
      // 021 EARS-12 — actionable IN THE FIELD where it occurred: the code names
      // the FIRST missing access condition in declared order, so the client can
      // point at one checkbox rather than at the block. `missingConsentPurposes`
      // still carries every missing purpose, so a client that wants to mark both
      // boxes has the data without a second round trip.
      const first = missing[0] as string;
      throw new UnprocessableEntityException({
        code:
          DOCTOR_REGISTER_CONSENT_REFUSAL_CODES[first] ??
          MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
        message: `the ${first} consent is required`,
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
   * command's own flag, plus every OTHER purpose this surface declares and the
   * caller granted — each stamped with the server's wording version.
   *
   * Deriving the declaration row from `medicalWorkerDeclaration` rather than
   * trusting the array is what keeps the flag and the record from ever
   * disagreeing — the checkbox the doctor ticked IS the row that is written.
   * EARS-6's "an ungranted optional purpose produces no record at all" holds by
   * construction: an ungranted purpose is simply absent from the array; there is
   * no `granted: false` shape to store, and nothing here invents one.
   *
   * Two rules make the resulting rows trustworthy (021 EARS-7, ADR-0009 §2.1):
   *
   * 1. **The version is always ours.** Every declared purpose is re-stamped from
   *    its own constant, so a row can only ever claim wording this surface
   *    actually rendered. A client-supplied version would let the record assert
   *    a text the doctor never saw.
   * 2. **The purpose list is closed.** `DOCTOR_REGISTER_CONSENT_PURPOSES` is the
   *    contract's closed list and `DoctorRegisterConsentAcceptanceSchema`
   *    already refuses anything else at the I/O boundary; the guard here is the
   *    DOMAIN statement of the same rule — for exactly the reason the required-
   *    purpose guard above is stated twice — so an undeclared purpose can never
   *    reach `consent_records` through a caller that bypasses the DTO pipe.
   *
   * 3. **One row per purpose.** A payload naming the same purpose twice would
   *    otherwise leave two permanent rows.
   *
   * `consent_records` is append-only and has no status column, so a row written
   * here is permanent: withdrawal is a manager-side operation of feature 037
   * (021 design §4), not a second row and not a flag flip.
   */
  private accessConditionConsents(
    req: DoctorRegisterRequest,
  ): ConsentAcceptance[] {
    const granted = req.consent.flatMap((entry) => {
      // The declaration is derived from the flag above, never from the array.
      if (entry.purpose === MEDICAL_WORKER_DECLARATION_PURPOSE) return [];
      // Rule 2, the domain half: an undeclared purpose reaches no record.
      if (!isDoctorRegisterConsentPurpose(entry.purpose)) return [];
      // Rule 1: presence is the grant, the version is ours to stamp.
      return [
        {
          purpose: entry.purpose,
          version: SERVER_STAMPED_CONSENT_VERSIONS[entry.purpose],
        },
      ];
    });
    // Rule 3: ONE row per purpose. `consent_records` is append-only, so a
    // payload that names the same purpose twice would leave two permanent rows
    // and make "the granted version" ambiguous for the manager view that reads
    // them. Every declared purpose now carries the same server-stamped version
    // anyway, so the duplicates are indistinguishable and the first wins.
    const supplied = [
      ...new Map(granted.map((entry) => [entry.purpose, entry])).values(),
    ];
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

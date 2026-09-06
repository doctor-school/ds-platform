import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  ConsentAcceptance,
  DoctorConfirmPrimaryAction,
  DoctorConfirmRequest,
  DoctorConfirmResponse,
  DoctorRegisterRequest,
  DoctorRegisterResponse,
  RegistrationIntent,
} from "@ds/schemas";
import {
  DOCTOR_CABINET_PATH,
  DOCTOR_EVENTS_FEED_PATH,
  DOCTOR_REGISTER_CONSENT_REFUSAL_CODES,
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  parseDoctorHostReturnTarget,
  PARTNER_DATA_SHARING_PURPOSE,
  REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES,
} from "@ds/schemas";

import { AuthService } from "../auth/auth.service.js";
import { EventsService } from "../events/events.service.js";

/**
 * The version stamped on the declaration when it is granted (ADR-0009 —
 * consents are per-purpose AND versioned; a bare boolean is not a consent
 * record). It is the version of the wording the doctor actually read, so it
 * changes when the canvas copy of the declaration changes, never silently.
 */
export const MEDICAL_WORKER_DECLARATION_VERSION = "2026-09";

/**
 * The version stamped on the partner-data consent (021 EARS-5). Same rule as
 * the declaration's: it is the version of the WORDING the doctor read, which is
 * assembled from `PARTNER_DATA_COMPOSITION` — so a change to the shared
 * composition is a change to this constant, and the two never drift apart
 * silently.
 *
 * Server-stamped rather than trusted from the payload: a client-supplied
 * version would let the recorded row claim a wording the surface never rendered.
 */
export const PARTNER_DATA_SHARING_VERSION = "2026-09";

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
    // 020 LD-1 — the ONE public event read, injected rather than re-queried:
    // «is this event still live» is a fact of the event, and a storefront-local
    // query for it would be the second read model LD-1 forbids.
    @Inject(EventsService) private readonly events: EventsService,
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
   * 021 EARS-10 — `ConfirmEmail`: verify the code through the 003 engine and
   * resolve, server-side, where the doctor goes next.
   *
   * Three steps, in this order and for these reasons:
   *
   * 1. **Parse the carried target** with the shipped guard. A hostile or
   *    undeclared value is treated as ABSENT — the doctor lands on the LD-4
   *    default — never followed and never turned into a 4xx: a query parameter
   *    the doctor never typed must not fail a confirmation the IdP accepted,
   *    and a refusal would be a probe for what the whitelist admits.
   * 2. **Delegate the verification**, unchanged, to {@link AuthService.verify}
   *    (003 EARS-3). 021 defines no second code path; a wrong code raises the
   *    003 generic 400 from inside that call, so no landing is ever resolved —
   *    let alone leaked — for a confirmation that did not happen.
   * 3. **Resolve the landing** (LD-4 / LD-8) from the ONE public event read.
   *
   * The success state carries `credited: null` and `profileCompletion: null`:
   * both are wave-2 facts (#1545) and LD-6 forbids deriving either from
   * configuration, so release 1 states the absence rather than a placeholder.
   */
  async confirm(req: DoctorConfirmRequest): Promise<DoctorConfirmResponse> {
    // Step 1 — pure, side-effect-free, and deliberately BEFORE the IdP hop so
    // the guard's verdict can never depend on whether the code was right.
    const intent = parseDoctorHostReturnTarget(req.returnTo);

    // Step 2 — the 003 engine. It throws the generic 400 on an unknown account
    // or a rejected code (003 EARS-16 enumeration safety), which is what keeps
    // every branch below unreachable for a failed confirmation.
    const verified = await this.auth.verify({
      email: req.email,
      code: req.code,
    });

    return {
      status: verified.status,
      credited: null,
      profileCompletion: null,
      primaryAction: await this.resolvePrimaryAction(intent),
      // EARS-10: «в личный кабинет» is present and SECONDARY. The account page
      // is never the default outcome of registration.
      secondaryAction: { kind: "cabinet", href: DOCTOR_CABINET_PATH },
    };
  }

  /**
   * LD-4 / LD-8 — the primary action.
   *
   * Every `href` this returns is either the guard's own reconstruction
   * (`intent.returnTo`) or the one closed literal {@link DOCTOR_EVENTS_FEED_PATH}
   * — never a string built from the raw request (021-design §3, property 1).
   *
   * The degraded branches follow LD-8's «nearest honest destination»: a stale
   * event whose page still exists sends the doctor to THAT page (which, for the
   * feed shape, is the feed URL they left — the exact stateful URL 019 EARS-12
   * requires), and an event with no page at all sends them to the feed. Every
   * degraded branch carries a `reason`, so the surface states what happened
   * instead of performing the silent redirect LD-8 forbids.
   */
  private async resolvePrimaryAction(
    intent: RegistrationIntent | null,
  ): Promise<DoctorConfirmPrimaryAction> {
    // LD-4 — a direct arrival, or a target of no declared doctor-host shape.
    // The feed is the SERVER's default: the LD-4 home fallback needs the
    // specialty choice only the doctor host resolves, so the host may render
    // its own shell on top; the server never guesses one.
    if (intent === null) {
      return { kind: "landing", href: DOCTOR_EVENTS_FEED_PATH };
    }

    const page = await this.events.publicEventPage(intent.eventSlug);

    // No public body at all — a `draft` or a non-existent id, ONE answer by
    // 004 EARS-6 so this surface cannot become an existence oracle.
    if (page === null) {
      return {
        kind: "landing",
        href: DOCTOR_EVENTS_FEED_PATH,
        reason: "missing",
      };
    }

    // `hidden` — the event exists and its direct link resolves to a public
    // notice (004 EARS-5), which is not a destination worth landing on.
    if (page.state === "hidden") {
      return {
        kind: "landing",
        href: DOCTOR_EVENTS_FEED_PATH,
        reason: "unpublished",
      };
    }

    // The эфир is over. `in_archive` is the legacy machine's terminal state
    // (014-design §3.1) and reads identically to a doctor: there is nothing to
    // participate in. Its page still exists, so that page is the nearest
    // honest destination.
    if (page.state === "ended" || page.state === "in_archive") {
      return { kind: "landing", href: intent.returnTo, reason: "ended" };
    }

    // 020 LD-5: `0` is «мест нет», `null` is «unlimited». Conflating them would
    // invent a sold-out state for every online webinar.
    if (page.seatsLeft === 0) {
      return { kind: "landing", href: intent.returnTo, reason: "full" };
    }

    return { kind: "return", href: intent.returnTo };
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
    const supplied = req.consent
      .filter((entry) => entry.purpose !== MEDICAL_WORKER_DECLARATION_PURPOSE)
      // 021 EARS-5 — the partner-data row carries the SERVER's wording version,
      // never the caller's claim about which wording was on screen. Presence in
      // the array is the grant; the version is ours to stamp.
      .map((entry) =>
        entry.purpose === PARTNER_DATA_SHARING_PURPOSE
          ? { ...entry, version: PARTNER_DATA_SHARING_VERSION }
          : entry,
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

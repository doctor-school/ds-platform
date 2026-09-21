import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { DrizzleHandle, RegistrationAnswers } from "@ds/db";
import { consentRecords, events, registrations } from "@ds/db";
import {
  CONGRESS_PERSONAL_DATA_PURPOSE,
  isRegistrable,
  toCongressSignUpAnswers,
  type CongressSignUpAccepted,
  type CongressSignUpAnswers,
  type CongressSignUpConsentPurpose,
  type CongressSignUpRequest,
  type CongressSignUpWindowRefusal,
  type EventLifecycleState,
} from "@ds/schemas";
import { AuthService } from "../auth/auth.service.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  resolveCongressSignUpSettings,
  resolveCongressSignUpWindow,
  type CongressSignUpSettings,
} from "./congress-signup.config.js";
import {
  CONGRESS_SIGN_UP_CLOCK,
  CONGRESS_SIGN_UP_ENV,
  type CongressSignUpClock,
  type CongressSignUpEnvReader,
} from "./congress-signup.tokens.js";

type Db = DrizzleHandle["db"];

/**
 * 044 EARS-5 — the contract's answers object must be storable in the
 * `registrations.answers` column WITHOUT a cast, checked HERE because this
 * service is the column's only writer.
 *
 * `@ds/db` mirrors `CongressSignUpAnswersSchema` by hand (it sits below
 * `@ds/schemas` in the dependency order and declines the inversion), so the two
 * can drift. This assertion is where that drift becomes a compile error rather
 * than a runtime surprise in a jsonb column nobody reads until the roster does.
 */
type _CongressAnswersFitTheColumn =
  CongressSignUpAnswers extends RegistrationAnswers ? true : never;
const _congressAnswersFitTheColumn: _CongressAnswersFitTheColumn = true;
void _congressAnswersFitTheColumn;

/**
 * 044 — the ONE refusal every submitter gets when the intake cannot take a
 * submission for any reason other than the registration window.
 *
 * A misconfigured deployment, an event that is not registrable and an address
 * the platform already knows are three very different facts, and the submitter
 * is told none of them. The endpoint is unauthenticated: a distinguishable
 * refusal for the last of those would turn it into an «is this doctor on the
 * platform?» oracle, and the other two would let an outsider read the state of
 * a deployment. The operator gets the real reason in the server log.
 */
export const CONGRESS_SIGN_UP_UNAVAILABLE = {
  code: "sign-up-unavailable",
  message: "Заявка сейчас не может быть принята.",
} as const;

/** The human text of each window refusal (044 EARS-28). */
const WINDOW_REFUSAL_MESSAGES = {
  "not-yet-open": "Регистрация на конгресс ещё не открыта.",
  closed: "Регистрация на конгресс закрыта.",
} as const;

/**
 * 044 slice 2 — the public congress intake, new-email path.
 *
 * The order of the checks is the design's, and it is load-bearing: the DTO pipe
 * has already validated the submission and the guards have already run the
 * captcha and the rate limiter, then the WINDOW is decided from the clock
 * alone — before the configuration is read, before the event is loaded and
 * before the account lookup — so a refusal outside the window is provably
 * identical for a known and an unknown address and provably writes nothing.
 *
 * Everything the accepted path writes (the `users` mirror, the registration and
 * its consent row) happens in ONE transaction, opened by
 * {@link AuthService.createPasswordlessAccount} and continued in the callback
 * this service passes it.
 */
@Injectable()
export class CongressSignUpService {
  private readonly logger = new Logger(CongressSignUpService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(CONGRESS_SIGN_UP_CLOCK) private readonly now: CongressSignUpClock,
    @Inject(CONGRESS_SIGN_UP_ENV)
    private readonly readEnv: CongressSignUpEnvReader,
    private readonly auth: AuthService,
  ) {}

  /** 044 EARS-1 — take one public congress submission. */
  async signUp(
    request: CongressSignUpRequest,
  ): Promise<CongressSignUpAccepted> {
    this.assertInsideWindow();

    const settings = this.settingsOrRefuse();
    await this.assertRegistrableEvent(settings.eventId);

    const consent: {
      purpose: CongressSignUpConsentPurpose;
      version: string;
    }[] = [
      {
        purpose: CONGRESS_PERSONAL_DATA_PURPOSE,
        version: settings.consentVersion,
      },
    ];

    const created = await this.auth.createPasswordlessAccount(
      {
        email: request.email,
        surname: request.surname,
        firstName: request.firstName,
        consent,
      },
      async (tx, userId) => {
        // EARS-5 / EARS-29: the typed answers, with the normalised contact
        // phone beside the typed one. `users.phone` is deliberately not
        // written — see `createPasswordlessAccount`.
        await tx.insert(registrations).values({
          userId,
          eventId: settings.eventId,
          answers: toCongressSignUpAnswers(request),
        });
        // EARS-9 / EARS-10: exactly ONE consent row, the personal-data one, at
        // the SERVER-stamped version. The medical-worker declaration is neither
        // recorded nor demanded on this surface.
        await tx.insert(consentRecords).values(
          consent.map((c) => ({
            userId,
            purpose: c.purpose,
            version: c.version,
          })),
        );
      },
    );

    if (created.alreadyExisted) {
      // The existing-account branch is slice 3 (#2299 / #2300 / #2301): until it
      // lands, a known address is refused generically and NOTHING is written —
      // the deploy of this slice is held for those three by the PR's
      // `Release-requires:` line.
      this.logger.log(
        "congress sign-up: address already has an account; refused pending #2299/#2300/#2301",
      );
      throw new UnprocessableEntityException(CONGRESS_SIGN_UP_UNAVAILABLE);
    }

    return { status: "accepted" };
  }

  /** EARS-28 — the window, decided first and from the clock alone. */
  private assertInsideWindow(): void {
    const window = resolveCongressSignUpWindow(this.now());
    if (window.state === "open") return;

    const refusal: CongressSignUpWindowRefusal =
      window.state === "not-yet-open"
        ? {
            code: "not-yet-open",
            message: WINDOW_REFUSAL_MESSAGES["not-yet-open"],
            opensAt: window.opensAt,
          }
        : { code: "closed", message: WINDOW_REFUSAL_MESSAGES.closed };

    throw new UnprocessableEntityException(refusal);
  }

  /** EARS-5 / EARS-9 — the configured event and consent version, or a refusal. */
  private settingsOrRefuse(): CongressSignUpSettings {
    const resolved = resolveCongressSignUpSettings(this.readEnv());
    if (!resolved.ok) {
      this.logger.error(
        `congress sign-up refused: configuration problem (${resolved.reason})`,
      );
      throw new UnprocessableEntityException(CONGRESS_SIGN_UP_UNAVAILABLE);
    }
    return resolved.settings;
  }

  /**
   * EARS-5 — the configured event must exist and be registrable BEFORE an
   * account is created, so a misconfigured event id cannot leave a credential-
   * less account behind with no registration to justify it.
   */
  private async assertRegistrableEvent(eventId: string): Promise<void> {
    const [event] = await this.db
      .select({ state: events.state })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event || !isRegistrable(event.state as EventLifecycleState)) {
      this.logger.error(
        `congress sign-up refused: configured event ${eventId} is ${
          event ? `in state ${event.state}` : "absent"
        }`,
      );
      throw new UnprocessableEntityException(CONGRESS_SIGN_UP_UNAVAILABLE);
    }
  }
}

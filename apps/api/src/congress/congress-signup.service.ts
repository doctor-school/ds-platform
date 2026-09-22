import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
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

/** The audited transaction {@link AuthService.createPasswordlessAccount} opens. */
type AccountTransaction = Parameters<
  Parameters<AuthService["createPasswordlessAccount"]>[1]
>[0];

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
 * A misconfigured deployment and an event that is not registrable are two very
 * different facts, and the submitter is told neither. The endpoint is
 * unauthenticated, so a distinguishable refusal would let an outsider read the
 * state of a deployment. The operator gets the real reason in the server log.
 *
 * Whether the address already has an account is NOT one of the reasons: BOTH
 * paths are accepted (EARS-6 / EARS-7), which answers the «is this doctor on
 * the platform?» oracle more strongly than a shared refusal would.
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
 * 044 — the public congress intake, both account paths.
 *
 * The order of the checks is the design's, and it is load-bearing: the DTO pipe
 * has already validated the submission and the guards have already run the
 * captcha and the rate limiter, then the WINDOW is decided from the clock
 * alone — before the configuration is read, before the event is loaded and
 * before the account lookup — so a refusal outside the window is provably
 * identical for a known and an unknown address and provably writes nothing.
 *
 * Everything the accepted path writes (the `users` mirror where there is one to
 * write, the registration and its consent row) happens in ONE transaction,
 * opened by {@link AuthService.createPasswordlessAccount} and continued in the
 * callback this service passes it.
 *
 * That callback is ONE body for both account paths, not two branches: an address
 * the platform already knows and one it does not run exactly the same statements
 * in exactly the same order. This is what makes EARS-7's identical response true
 * by construction rather than by two code paths kept in sync — and it is why
 * `ON CONFLICT DO NOTHING` sits on the registration insert instead of a
 * preceding «is this pair already registered?» read: the uniqueness of
 * `(user_id, event_id)` is the database's invariant, and asking first would only
 * add a race the constraint already settles.
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

    // The return value is deliberately unused: whether the account already
    // existed changes nothing the participant may observe (EARS-7), and the
    // writes both paths need have already happened in the callback below.
    await this.auth.createPasswordlessAccount(
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
        //
        // EARS-8: DO NOTHING, never DO UPDATE. The `(user_id, event_id)` unique
        // constraint says one registration RECORD per pair for all time, and the
        // FIRST submission is the one that registered the participant — a repeat
        // must not silently rewrite the answers an organiser is already reading
        // off the roster, nor move the registration instant.
        await tx
          .insert(registrations)
          .values({
            userId,
            eventId: settings.eventId,
            answers: toCongressSignUpAnswers(request),
          })
          .onConflictDoNothing({
            target: [registrations.userId, registrations.eventId],
          });
        await this.recordConsentIfNewVersion(tx, userId, consent);
      },
    );

    return { status: "accepted" };
  }

  /**
   * EARS-8 / EARS-9 / EARS-10 — the consent ledger for this submission.
   *
   * Exactly ONE consent row per ACCEPTANCE, never one per submission: a
   * participant who sends the form twice agreed once, and a second identical row
   * would make an append-only ledger read as two separate acts of consent. A row
   * is written only when this pair has none yet, or when the version the server
   * publishes today differs from the one last recorded — in that case it IS a
   * fresh act of consent, to a different text, and belongs in the ledger as its
   * own row BESIDE (never instead of) the earlier one.
   *
   * The comparison is against the LATEST recorded row rather than «any row at
   * this version», so a participant who accepted v1, then v2, and then meets a
   * republished v1 is recorded as having accepted v1 again. `consent_records`
   * carries no unique constraint by design (ADR-0003 design §3.6 rule 4 — it is
   * legal evidence, and two acceptances of the same version at two instants are
   * two facts), so the idempotency of a repeat submission is THIS read, inside
   * the transaction the caller opened, and not a constraint.
   *
   * That makes the guarantee SEQUENTIAL, and deliberately so: two submissions
   * for the same participant racing under READ COMMITTED can both read «no row
   * at this version» and both insert, so a double-click can leave two identical
   * acceptance rows. For an append-only legal ledger that is a truthful record
   * of two submitted acceptances rather than a defect — nothing downstream
   * counts rows and the VERSION is what is read back — and closing it would
   * take either a constraint this ledger's own design rejects or a lock on the
   * participant row taken by every intake request. It is an open item on the
   * feature, not a promise this method silently makes.
   *
   * The medical-worker declaration is neither recorded nor demanded on this
   * surface (EARS-10): the only purposes written are the caller's.
   */
  private async recordConsentIfNewVersion(
    tx: AccountTransaction,
    userId: string,
    consent: readonly {
      purpose: CongressSignUpConsentPurpose;
      version: string;
    }[],
  ): Promise<void> {
    for (const c of consent) {
      const [latest] = await tx
        .select({ version: consentRecords.version })
        .from(consentRecords)
        .where(
          and(
            eq(consentRecords.userId, userId),
            eq(consentRecords.purpose, c.purpose),
          ),
        )
        .orderBy(desc(consentRecords.capturedAt))
        .limit(1);

      if (latest?.version === c.version) continue;

      await tx.insert(consentRecords).values({
        userId,
        purpose: c.purpose,
        version: c.version,
      });
    }
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

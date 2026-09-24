import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
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
import { MAILER, type Mailer } from "../mailer/mailer.types.js";
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
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly auth: AuthService,
  ) {}

  /** 044 EARS-1 — take one public congress submission. */
  async signUp(
    request: CongressSignUpRequest,
  ): Promise<CongressSignUpAccepted> {
    // EARS-28 — the settings come FIRST because the window is one of them: the
    // window cannot be decided before the configuration that states it is
    // readable. A broken configuration therefore answers the one generic
    // refusal rather than a window refusal, which is the honest answer — «ещё
    // не открыта» would tell the submitter a date the deployment does not
    // actually have. Both still refuse before any side effect, which is what
    // EARS-28 requires of the window check.
    const settings = this.settingsOrRefuse();
    this.assertInsideWindow(settings);
    const event = await this.loadRegistrableEvent(settings.eventId);

    const consent: {
      purpose: CongressSignUpConsentPurpose;
      version: string;
    }[] = [
      {
        purpose: CONGRESS_PERSONAL_DATA_PURPOSE,
        version: settings.consentVersion,
      },
    ];

    // EARS-13: which account path this call took decides which paragraph the
    // confirmation email carries — and it is RECORDED on the registration row
    // rather than read off this call's return value, because the two disagree
    // exactly when it matters. A participant whose first submission created the
    // account but whose mail was rejected resubmits (EARS-12); on that second
    // call the account exists, so the current-call flag would hand them the
    // «войдите в существующий аккаунт» paragraph for an account this very
    // intake had minted. The row's own `account_created_by_intake`, frozen by
    // `ON CONFLICT DO NOTHING` at the first submission, is the truth.
    //
    // Nothing the participant may observe on the wire branches on it (EARS-7) —
    // the mail reaches only the address that submitted the form, which is not a
    // channel a third party can compare.
    const account = await this.auth.createPasswordlessAccount(
      {
        email: request.email,
        surname: request.surname,
        firstName: request.firstName,
        consent,
      },
      async (tx, userId, alreadyExisted) => {
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
            // EARS-12: the confirmation paragraph, decided once and stored.
            // `ON CONFLICT DO NOTHING` below keeps the FIRST submission's value,
            // which is exactly the guarantee a re-send needs.
            accountCreatedByIntake: !alreadyExisted,
          })
          .onConflictDoNothing({
            target: [registrations.userId, registrations.eventId],
          });
        await this.recordConsentIfNewVersion(tx, userId, consent);
      },
    );

    // EARS-11: the transaction above has COMMITTED by the time
    // `createPasswordlessAccount` resolves, and the dispatch below is started
    // and not awaited - so the response is never delayed by the relay and can
    // never be turned into a refusal by it.
    this.dispatchConfirmationEmail({
      userId: account.userId,
      eventId: settings.eventId,
      email: request.email,
      eventTitle: event.title,
      eventStartsAt: event.startsAt,
      eventVenue: settings.eventVenue,
    });

    return { status: "accepted" };
  }

  /**
   * 044 EARS-11 / EARS-12 - send the confirmation email off the response path
   * and record which way it went.
   *
   * Three properties, and each is why a line of this method looks the way it
   * does:
   *
   * 1. **It is started, never awaited** (the `void (async ...)()` of
   *    `AuthService.dispatchEmail`). A relay that is slow, unreachable or
   *    hostile must not be able to hold a committed registration's response
   *    open, and must not be able to fail it.
   * 2. **It reads the row back before sending.** The re-select is what makes
   *    EARS-12's "no second email" true: a participant who submits the form
   *    twice hits `ON CONFLICT DO NOTHING` on the registration, so the only
   *    record of the first dispatch is the column - and a `sent` there ends
   *    this method before the mailer is touched. A `failed` (or a `NULL` left
   *    by an interrupted first attempt) re-dispatches, which is the feature's
   *    ENTIRE recovery mechanism: no outbox, no scheduled sweep, the
   *    participant resubmitting (design section "Mail failure"). The same
   *    re-select is where the confirmation's PARAGRAPH comes from: the row's
   *    `account_created_by_intake`, frozen at the first submission, so a
   *    re-send repeats the copy the failed send would have carried rather than
   *    the copy the current state of the IdP would suggest. A `NULL` there is a
   *    platform-origin row (EARS-16) - never reached from here, and if it ever
   *    were, `=== true` resolves it to the existing-account paragraph, which is
   *    what a doctor already on the platform is owed anyway.
   * 3. **Every failure is swallowed, none is lost.** A relay rejection becomes
   *    `failed` on the row - a fact the roster can show and the next submission
   *    can act on - rather than a log line nobody reads. The outer `catch` is
   *    for the case where even that write fails: there is no caller left to
   *    tell, and an unhandled rejection off the response path would take the
   *    process down for a registration that is safely committed.
   *
   * The recorded instant is the moment the OUTCOME was known, not the moment
   * the send started: it is what a registrar reads as "when did we last try".
   */
  private dispatchConfirmationEmail(input: {
    userId: string;
    eventId: string;
    email: string;
    eventTitle: string;
    eventStartsAt: Date;
    eventVenue: string;
  }): void {
    const registrationRow = and(
      eq(registrations.userId, input.userId),
      eq(registrations.eventId, input.eventId),
    );

    void (async () => {
      try {
        const [existing] = await this.db
          .select({
            status: registrations.confirmationMailStatus,
          })
          .from(registrations)
          .where(registrationRow)
          .limit(1);

        // No row means the registration this mail is about does not exist -
        // nothing to confirm, and nothing to record an outcome on.
        if (!existing) return;
        if (existing.status === "sent") return;

        let status: "sent" | "failed" = "sent";
        try {
          await this.mailer.sendCongressRegistrationConfirmation({
            email: input.email,
            eventTitle: input.eventTitle,
            eventStartsAt: input.eventStartsAt,
            eventVenue: input.eventVenue,
          });
        } catch {
          // The mailer's own diagnostics already carry the sanitized provider
          // outcome; re-logging the error here risks putting the recipient
          // address or provider text in a log line, and adds nothing.
          status = "failed";
          this.logger.warn(
            `congress confirmation email rejected for event ${input.eventId}`,
          );
        }

        // A `sent` outcome is written unconditionally; a `failed` one only
        // while the row is not already `sent`. Two dispatches for the same
        // registration can overlap — the participant double-submits, or
        // resubmits while a slow first attempt is still in the relay — and
        // without the predicate the loser's rejection would overwrite the
        // winner's success, turning a delivered email into a `failed` the
        // roster shows and the next submission re-sends on.
        await this.db
          .update(registrations)
          .set({
            confirmationMailStatus: status,
            confirmationMailAt: new Date(),
          })
          .where(
            status === "sent"
              ? registrationRow
              : and(
                  registrationRow,
                  sql`${registrations.confirmationMailStatus} IS DISTINCT FROM 'sent'`,
                ),
          );
      } catch {
        this.logger.warn(
          `congress confirmation email outcome could not be recorded for event ${input.eventId}`,
        );
      }
    })();
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

  /** EARS-28 — the configured window against the clock, before any side effect. */
  private assertInsideWindow(settings: CongressSignUpSettings): void {
    const window = resolveCongressSignUpWindow(this.now(), {
      opensAt: settings.windowOpensAt,
      closesAt: settings.windowClosesAt,
    });
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

  /** EARS-5 / EARS-9 / EARS-28 — the whole configured intake, or a refusal. */
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
   *
   * EARS-13 - it also returns the title and the start instant, read on the SAME
   * hop rather than by the mail dispatch a moment later. That dispatch runs off
   * the response path, where a second query would be a second thing able to
   * fail after the participant has already been told "accepted"; reading both
   * here also guarantees the mail describes the very event the registration was
   * checked against.
   */
  private async loadRegistrableEvent(
    eventId: string,
  ): Promise<{ title: string; startsAt: Date }> {
    const [event] = await this.db
      .select({
        state: events.state,
        title: events.title,
        startsAt: events.startsAt,
      })
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

    return { title: event.title, startsAt: event.startsAt };
  }
}

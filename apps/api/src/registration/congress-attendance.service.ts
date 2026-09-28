import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  CONGRESS_DAY_UNKNOWN,
  type CongressAttendanceResponse,
} from "@ds/schemas";
import { resolveCongressEventDays } from "../congress/congress-signup.config.js";
import {
  CONGRESS_SIGN_UP_ENV,
  type CongressSignUpEnvReader,
} from "../congress/congress-signup.tokens.js";
import { RegistrationRepository } from "./registration.repository.js";

/** The machine code of the «congress days not configured» refusal. */
export const CONGRESS_DAYS_UNCONFIGURED = "CONGRESS_DAYS_UNCONFIGURED" as const;

/**
 * 044 EARS-34 — the registrar's per-day attendance: the configured congress
 * days, the day check, and the mark itself.
 *
 * The days are read from configuration PER CALL through the congress module's
 * own env reader (`CONGRESS_SIGN_UP_ENV`) with the same validation the intake
 * applies — one reader, one rule, so the days the desk marks are exactly the
 * days the deployment declares.
 *
 * Who marked a participant, and when, is not stored here: the write runs in the
 * request audit context and the 010 trigger on `registration_attendance`
 * appends the ledger row naming the acting registrar with source `admin-ui`.
 */
@Injectable()
export class CongressAttendanceService {
  private readonly logger = new Logger(CongressAttendanceService.name);

  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(RegistrationRepository)
    private readonly repo: RegistrationRepository,
    @Inject(CONGRESS_SIGN_UP_ENV)
    private readonly readEnv: CongressSignUpEnvReader,
  ) {}

  /**
   * The configured congress days, ascending. A deployment without a usable
   * `CONGRESS_SIGNUP_EVENT_DAYS` cannot answer «which days are there», so the
   * desk's attendance surfaces refuse (503) rather than render a roster with no
   * day to mark; the reason goes to the server log.
   */
  congressDays(): readonly string[] {
    const resolved = resolveCongressEventDays(
      this.readEnv().CONGRESS_SIGNUP_EVENT_DAYS,
    );
    if (!resolved.ok) {
      this.logger.error(
        `congress attendance refused: configuration problem (${resolved.reason})`,
      );
      throw new ServiceUnavailableException({
        code: CONGRESS_DAYS_UNCONFIGURED,
        message: "Дни конгресса не настроены.",
      });
    }
    return resolved.days;
  }

  /** 422 `CONGRESS_DAY_UNKNOWN` unless `day` is one of `days`. */
  assertCongressDay(day: string, days: readonly string[]): void {
    if (!days.includes(day)) {
      throw new UnprocessableEntityException({
        code: CONGRESS_DAY_UNKNOWN,
        message: "Эта дата не является днём конгресса.",
      });
    }
  }

  /**
   * Set `registrationId`'s attendance on `day`. The day is checked first (no
   * DB read for an off-calendar date); a registration that is not one of
   * `eventKey`'s — or an event that does not exist — is the same 404.
   */
  async mark(
    eventKey: string,
    registrationId: string,
    day: string,
    present: boolean,
  ): Promise<CongressAttendanceResponse> {
    this.assertCongressDay(day, this.congressDays());
    const event = await this.repo.findEventHeader(eventKey);
    const found =
      event !== undefined &&
      (await this.repo.setAttendance(event.id, registrationId, day, present));
    if (!found) throw new NotFoundException("registration not found");
    return { registrationId, day, present };
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  Logger,
} from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import {
  congressSubmissionKindSettings,
  congressSubmissions,
  congressSubmissionSettings,
  consentRecords,
  events,
  registrations,
  users,
  type CongressSubmissionRow,
} from "@ds/db";
import {
  CONGRESS_SUBMISSION_KIND_LABELS,
  CONGRESS_SUBMISSION_KINDS,
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
  type CongressSubmission,
  type CongressSubmissionCreateRequest,
  type CongressSubmissionDraftAuthor,
  type CongressSubmissionDraftContent,
  type CongressSubmissionKind,
  type CongressSubmissionKindIntake,
  type CongressSubmissionProblem,
  type CongressSubmissionSection,
  type CongressSubmissionSendRequest,
  type CongressSubmissionStatus,
  type CongressSubmissionWithdrawRequest,
  congressKindIntakeState,
  hasCongressSubmissionForm,
  lastDayOfClosingInstant,
  parseCongressDraftBody,
  parseCongressSendContent,
} from "@ds/schemas";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  type AuditedTransaction,
  withRequestAuditContext,
} from "../audit/audit-context.tx.js";
import { MAILER, type Mailer } from "../mailer/mailer.types.js";
import { resolveCongressConsentVersion } from "./congress-signup.config.js";
import {
  CONGRESS_CABINET_URL,
  CONGRESS_SIGN_UP_CLOCK,
  CONGRESS_SIGN_UP_ENV,
  type CongressSignUpClock,
  type CongressSignUpEnvReader,
} from "./congress-signup.tokens.js";

type Db = DrizzleHandle["db"];
type Reader = Pick<Db, "select">;

/** Canonical UUID shape — a non-uuid id names nothing (404, not a driver error). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface KindWindow {
  opensAt: Date | null;
  closesAt: Date | null;
  submitLimit: number | null;
}

const NO_WINDOW: KindWindow = {
  opensAt: null,
  closesAt: null,
  submitLimit: null,
};

/** A refusal naming every unmet condition (EARS-9). */
function refuse(problems: CongressSubmissionProblem[]): never {
  throw new UnprocessableEntityException({ problems });
}

/** A refusal because of the row's status (EARS-7, EARS-9, EARS-13). */
function statusConflict(status: CongressSubmissionStatus): never {
  throw new ConflictException({
    problems: [{ code: "status-conflict", params: { status } }],
  });
}

/**
 * 046 EARS-5…EARS-13, EARS-16, EARS-17 (#2433) — the author's congress
 * submissions (`apps/api/src/congress/README.md`, «Submissions»).
 *
 * Every read and write is scoped to the session's account: a row of another
 * account is «not found», never «forbidden», so ids cannot be probed. Every
 * write runs in the request audit context, so the 010 trigger records who moved
 * a submission and when — that ledger is the status history (EARS-28).
 *
 * The send runs the whole cascade in one transaction before any change
 * (EARS-9): registration, kind window, complete field set, limit under an
 * advisory lock (EARS-17) and the submission consent (EARS-16). A refusal
 * throws inside the transaction, so nothing is written.
 */
@Injectable()
export class CongressSubmissionsService {
  private readonly logger = new Logger(CongressSubmissionsService.name);

  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(CONGRESS_SIGN_UP_CLOCK) private readonly now: CongressSignUpClock,
    @Inject(CONGRESS_SIGN_UP_ENV) private readonly env: CongressSignUpEnvReader,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONGRESS_CABINET_URL) private readonly cabinetUrl: string,
  ) {}

  // ---------------------------------------------------------------- reads

  /**
   * EARS-4, EARS-5, EARS-10, EARS-11 — the author's section for one event;
   * `null` is the congress event: the event with intake settings that starts
   * latest (046-design «Entry and return»).
   */
  async section(
    sub: string,
    requestedEventId: string | null,
  ): Promise<CongressSubmissionSection> {
    const user = await this.account(sub);
    const eventId = requestedEventId ?? (await this.congressEventId(this.db));
    const settings = await this.settings(this.db, eventId);
    const [event] = await this.db
      .select({
        slug: events.slug,
        title: events.title,
        startsAt: events.startsAt,
        durationMin: events.durationMin,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    if (!event) throw new NotFoundException("no congress section");
    const registration = await this.activeRegistration(this.db, user.id, eventId);
    const now = this.now();

    const rows = registration
      ? await this.db
          .select()
          .from(congressSubmissions)
          .where(
            and(
              eq(congressSubmissions.userId, user.id),
              eq(congressSubmissions.eventId, eventId),
              eq(congressSubmissions.registrationId, registration.id),
              eq(congressSubmissions.recordStatus, "active"),
            ),
          )
          .orderBy(desc(congressSubmissions.createdAt))
      : [];

    const windows = await this.windows(this.db, eventId);
    const kinds: CongressSubmissionKindIntake[] = CONGRESS_SUBMISSION_KINDS.map(
      (kind) => {
        const w = windows.get(kind) ?? NO_WINDOW;
        return {
          kind,
          state: congressKindIntakeState(w, now),
          opensAt: w.opensAt?.toISOString() ?? null,
          closesAt: w.closesAt?.toISOString() ?? null,
          lastDay: w.closesAt ? lastDayOfClosingInstant(w.closesAt) : null,
          submitLimit: w.submitLimit,
          used: rows.filter((r) => r.kind === kind && r.status !== "draft")
            .length,
          offered: hasCongressSubmissionForm(kind),
        };
      },
    );

    return {
      eventId,
      event: {
        slug: event.slug,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        endsAt: new Date(
          event.startsAt.getTime() + event.durationMin * 60_000,
        ).toISOString(),
      },
      registered: registration !== null,
      registrationUrl: settings.registrationUrl,
      consentRequired: await this.consentRequired(this.db, user.id),
      kinds,
      submissions: rows.map(project),
    };
  }

  // ---------------------------------------------------------------- writes

  /** EARS-5, EARS-6 — a new draft of one kind, author 1 prefilled. */
  async create(
    sub: string,
    body: CongressSubmissionCreateRequest,
  ): Promise<CongressSubmission> {
    const user = await this.account(sub);
    if (!hasCongressSubmissionForm(body.kind)) {
      refuse([{ code: "kind-not-available", params: { kind: body.kind } }]);
    }
    return withRequestAuditContext(this.db, async (tx) => {
      await this.settings(tx, body.eventId);
      const registration = await this.activeRegistration(
        tx,
        user.id,
        body.eventId,
      );
      if (!registration) refuse([{ code: "registration-required" }]);

      // EARS-6 — as to the window, creating is refused only after closing.
      const w = (await this.windows(tx, body.eventId)).get(body.kind);
      if (w?.closesAt && this.now().getTime() >= w.closesAt.getTime()) {
        refuse([
          { code: "kind-closed", params: { closesAt: w.closesAt.toISOString() } },
        ]);
      }

      const [row] = await tx
        .insert(congressSubmissions)
        .values({
          eventId: body.eventId,
          registrationId: registration.id,
          userId: user.id,
          kind: body.kind,
          authors: [firstAuthor(registration.answers)],
        })
        .returning();
      return project(row!);
    });
  }

  /** EARS-7 — store the draft content; types and maximum lengths only. */
  async autosave(
    sub: string,
    id: string,
    content: CongressSubmissionDraftContent,
  ): Promise<CongressSubmission> {
    const user = await this.account(sub);
    return withRequestAuditContext(this.db, async (tx) => {
      const row = await this.ownRow(tx, user.id, id, true);
      if (!this.editable(row)) statusConflict(row.status);

      let body = row.body;
      if (content.body !== undefined) {
        const parsed = parseCongressDraftBody(row.kind, content.body);
        if (!parsed) {
          throw new BadRequestException(
            `the body does not fit the ${row.kind} form`,
          );
        }
        body = parsed;
      }
      const [saved] = await tx
        .update(congressSubmissions)
        .set({
          title: content.title ?? row.title,
          authors: content.authors ?? row.authors,
          body,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.status, row.status),
          ),
        )
        .returning();
      if (!saved) statusConflict(row.status);
      return project(saved);
    });
  }

  /** EARS-9, EARS-16, EARS-17 — the send cascade, all-or-nothing. */
  async send(
    sub: string,
    id: string,
    request: CongressSubmissionSendRequest,
  ): Promise<CongressSubmission> {
    const user = await this.account(sub);
    const submitted = await withRequestAuditContext(this.db, async (tx) => {
      const row = await this.ownRow(tx, user.id, id, true);
      // The resend of a `needs_revision` submission is the committee work
      // package's (EARS-30); here the author sends drafts.
      if (row.status !== "draft") statusConflict(row.status);

      // EARS-17 — serialise concurrent sends of one account, event and kind.
      const lockKey = `congress-submission:${user.id}:${row.eventId}:${row.kind}`;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      const problems: CongressSubmissionProblem[] = [];

      const registration = await this.activeRegistration(
        tx,
        user.id,
        row.eventId,
      );
      if (!registration || registration.id !== row.registrationId) {
        problems.push({ code: "registration-required" });
      }

      const w = (await this.windows(tx, row.eventId)).get(row.kind) ?? NO_WINDOW;
      const state = congressKindIntakeState(w, this.now());
      if (state === "not-announced" || state === "not-yet-open") {
        problems.push({
          code: "kind-not-open",
          params: { opensAt: w.opensAt?.toISOString() ?? null },
        });
      } else if (state === "closed") {
        problems.push({
          code: "kind-closed",
          params: { closesAt: w.closesAt?.toISOString() ?? null },
        });
      }

      const parsed = parseCongressSendContent(row.kind, {
        title: row.title,
        authors: row.authors,
        body: row.body,
      });
      if (!parsed.ok) problems.push(...parsed.problems);

      if (w.submitLimit !== null) {
        const [counted] = await tx
          .select({ n: count() })
          .from(congressSubmissions)
          .where(
            and(
              eq(congressSubmissions.userId, user.id),
              eq(congressSubmissions.eventId, row.eventId),
              eq(congressSubmissions.kind, row.kind),
              ne(congressSubmissions.status, "draft"),
              ne(congressSubmissions.id, row.id),
              eq(congressSubmissions.recordStatus, "active"),
            ),
          );
        if ((counted?.n ?? 0) >= w.submitLimit) {
          problems.push({
            code: "limit-reached",
            params: { limit: w.submitLimit },
          });
        }
      }

      const version = this.consentVersion();
      const consentMissing = !(await this.hasConsent(tx, user.id, version));
      const consentAccepted = request.acceptedConsents.includes(
        CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
      );
      if (consentMissing && !consentAccepted) {
        problems.push({
          code: "consent-required",
          params: { purpose: CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE },
        });
      }

      if (problems.length > 0) refuse(problems);
      if (!parsed.ok) refuse(parsed.problems);

      if (consentMissing) {
        await tx.insert(consentRecords).values({
          userId: user.id,
          purpose: CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
          version,
        });
      }

      const [sent] = await tx
        .update(congressSubmissions)
        .set({
          status: "submitted",
          title: parsed.content.title,
          authors: parsed.content.authors,
          body: parsed.content.body,
          submittedAt: sql`now()`,
          statusChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.status, "draft"),
          ),
        )
        .returning();
      if (!sent) statusConflict(row.status);
      return project(sent);
    });

    // EARS-14: the transaction above has COMMITTED; the receipt is started and
    // never awaited, so the relay can neither delay nor undo the `submitted`.
    this.dispatchReceipt(submitted.id);
    return submitted;
  }

  /**
   * EARS-14 — the author's receipt for a submission that just became
   * `submitted`, sent off the response path, with the outcome recorded on the
   * submission (`last_letter_kind`, `last_letter_status`, `last_letter_at`).
   *
   * The pattern of the 044 confirmation (`CongressSignUpService`
   * `dispatchConfirmationEmail`): started, never awaited; the letter is built
   * from the committed row read back; a relay rejection becomes `failed` on
   * the row and never touches the status; the outer `catch` keeps an
   * unrecordable outcome from becoming an unhandled rejection. No retry queue
   * (design «Letters»): the section always shows the status. The recorded
   * instant is when the outcome was known.
   */
  private dispatchReceipt(submissionId: string): void {
    void (async () => {
      try {
        const [letter] = await this.db
          .select({
            email: users.email,
            title: congressSubmissions.title,
            kind: congressSubmissions.kind,
            eventTitle: events.title,
          })
          .from(congressSubmissions)
          .innerJoin(users, eq(users.id, congressSubmissions.userId))
          .innerJoin(events, eq(events.id, congressSubmissions.eventId))
          .where(eq(congressSubmissions.id, submissionId))
          .limit(1);
        if (!letter) return;

        let status: "sent" | "failed" = "sent";
        try {
          await this.mailer.sendCongressSubmissionReceipt({
            email: letter.email ?? "",
            title: letter.title ?? "",
            kindLabel: CONGRESS_SUBMISSION_KIND_LABELS[letter.kind],
            eventTitle: letter.eventTitle,
            cabinetUrl: this.cabinetUrl,
          });
        } catch {
          // The mailer's own diagnostics carry the sanitized provider outcome;
          // re-logging the error could put the recipient address in a log line.
          status = "failed";
          this.logger.warn(
            `congress submission receipt rejected for submission ${submissionId}`,
          );
        }

        await withRequestAuditContext(this.db, (tx) =>
          tx
            .update(congressSubmissions)
            .set({
              lastLetterKind: "receipt",
              lastLetterStatus: status,
              lastLetterAt: new Date(),
            })
            .where(eq(congressSubmissions.id, submissionId)),
        );
      } catch {
        this.logger.warn(
          `congress submission receipt outcome could not be recorded for submission ${submissionId}`,
        );
      }
    })();
  }

  /**
   * EARS-12 — take back (`submitted` while the kind is open → `draft`) or
   * withdraw for good (`in_review`, `needs_revision`, or `submitted` after the
   * kind closed → `withdrawn`). The write is conditional on the status the
   * author saw, so a concurrent committee change wins and this is refused.
   */
  async withdraw(
    sub: string,
    id: string,
    request: CongressSubmissionWithdrawRequest,
  ): Promise<CongressSubmission> {
    const user = await this.account(sub);
    return withRequestAuditContext(this.db, async (tx) => {
      const row = await this.ownRow(tx, user.id, id, false);
      const refusal = (): never => {
        throw new ConflictException({
          problems: [
            { code: "withdraw-not-allowed", params: { status: row.status } },
          ],
        });
      };

      const expected = request.expectedStatus;
      let target: CongressSubmissionStatus;
      if (expected === "submitted") {
        const w =
          (await this.windows(tx, row.eventId)).get(row.kind) ?? NO_WINDOW;
        target =
          congressKindIntakeState(w, this.now()) === "open"
            ? "draft"
            : "withdrawn";
      } else if (expected === "in_review" || expected === "needs_revision") {
        target = "withdrawn";
      } else {
        return refusal();
      }

      const [changed] = await tx
        .update(congressSubmissions)
        .set({
          status: target,
          submittedAt: target === "draft" ? null : row.submittedAt,
          statusChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.userId, user.id),
            eq(congressSubmissions.status, expected),
          ),
        )
        .returning();
      if (!changed) return refusal();
      return project(changed);
    });
  }

  /** EARS-13 — delete a draft; any other status is refused. */
  async remove(sub: string, id: string): Promise<void> {
    const user = await this.account(sub);
    await withRequestAuditContext(this.db, async (tx) => {
      const row = await this.ownRow(tx, user.id, id, true);
      if (row.status !== "draft") statusConflict(row.status);
      // ADR-0003 §3.6: a retained row is retired, never physically removed.
      const [retired] = await tx
        .update(congressSubmissions)
        .set({
          recordStatus: "retired",
          deletedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.status, "draft"),
            eq(congressSubmissions.recordStatus, "active"),
          ),
        )
        .returning({ id: congressSubmissions.id });
      if (!retired) statusConflict(row.status);
    });
  }

  // ---------------------------------------------------------------- helpers

  private async account(
    sub: string,
  ): Promise<{ id: string }> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    if (!user) throw new UnauthorizedException("authentication required");
    return user;
  }

  /** The congress event: settings present, latest start; none ⇒ 404 (EARS-1). */
  private async congressEventId(db: Reader): Promise<string> {
    const [row] = await db
      .select({ id: events.id })
      .from(congressSubmissionSettings)
      .innerJoin(events, eq(events.id, congressSubmissionSettings.eventId))
      .orderBy(desc(events.startsAt))
      .limit(1);
    if (!row) throw new NotFoundException("no congress section");
    return row.id;
  }

  /** The event's congress settings; none ⇒ no congress section (EARS-1). */
  private async settings(db: Reader, eventId: string) {
    if (!UUID_RE.test(eventId)) throw new NotFoundException("no congress section");
    const [row] = await db
      .select()
      .from(congressSubmissionSettings)
      .where(eq(congressSubmissionSettings.eventId, eventId))
      .limit(1);
    if (!row) throw new NotFoundException("no congress section");
    return row;
  }

  private async windows(
    db: Reader,
    eventId: string,
  ): Promise<Map<CongressSubmissionKind, KindWindow>> {
    const rows = await db
      .select()
      .from(congressSubmissionKindSettings)
      .where(eq(congressSubmissionKindSettings.eventId, eventId));
    return new Map(
      rows.map((r) => [
        r.kind,
        { opensAt: r.opensAt, closesAt: r.closesAt, submitLimit: r.submitLimit },
      ]),
    );
  }

  private async activeRegistration(db: Reader, userId: string, eventId: string) {
    const [row] = await db
      .select({ id: registrations.id, answers: registrations.answers })
      .from(registrations)
      .where(
        and(
          eq(registrations.userId, userId),
          eq(registrations.eventId, eventId),
          eq(registrations.recordStatus, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * The account's row, locked for the write when asked. A row of another
   * account, or one whose registration is no longer active, is «not found».
   */
  private async ownRow(
    tx: AuditedTransaction,
    userId: string,
    id: string,
    lock: boolean,
  ): Promise<CongressSubmissionRow> {
    if (!UUID_RE.test(id)) throw new NotFoundException("submission not found");
    const query = tx
      .select({ s: congressSubmissions })
      .from(congressSubmissions)
      .innerJoin(
        registrations,
        eq(registrations.id, congressSubmissions.registrationId),
      )
      .where(
        and(
          eq(congressSubmissions.id, id),
          eq(congressSubmissions.userId, userId),
          eq(congressSubmissions.recordStatus, "active"),
          eq(registrations.recordStatus, "active"),
        ),
      )
      .limit(1);
    const [found] = lock
      ? await query.for("update", { of: congressSubmissions })
      : await query;
    if (!found) throw new NotFoundException("submission not found");
    return found.s;
  }

  /** EARS-7 — a draft, or a `needs_revision` before its revision deadline. */
  private editable(row: CongressSubmissionRow): boolean {
    if (row.status === "draft") return true;
    return (
      row.status === "needs_revision" &&
      row.revisionDueAt !== null &&
      this.now().getTime() < row.revisionDueAt.getTime()
    );
  }

  /** EARS-16 — the server-stamped version of the congress site policy. */
  private consentVersion(): string {
    const resolved = resolveCongressConsentVersion(this.env());
    if (!resolved.ok) {
      this.logger.error(
        `congress submission consent unavailable: ${resolved.reason}`,
      );
      throw new ServiceUnavailableException(
        "the submission consent is not configured",
      );
    }
    return resolved.version;
  }

  /** EARS-16 — one row per account and version, regardless of event. */
  private async hasConsent(
    db: Reader,
    userId: string,
    version: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.userId, userId),
          eq(consentRecords.purpose, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE),
          eq(consentRecords.version, version),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async consentRequired(db: Reader, userId: string): Promise<boolean> {
    return !(await this.hasConsent(db, userId, this.consentVersion()));
  }
}

/**
 * EARS-6 — author 1 from the registration answers. The account has no
 * structured name, so without answers the name fields stay empty for the
 * author to fill; the display name is never split into name parts.
 */
function firstAuthor(
  answers: {
    surname: string;
    firstName: string;
    patronymic?: string | undefined;
    workplace: string;
  } | null,
): CongressSubmissionDraftAuthor {
  if (!answers) return { presenting: true };
  return {
    surname: answers.surname,
    firstName: answers.firstName,
    ...(answers.patronymic ? { patronymic: answers.patronymic } : {}),
    workplace: answers.workplace,
    presenting: true,
  };
}

/** EARS-11 — the author's view of one row; the comment only where it applies. */
function project(row: CongressSubmissionRow): CongressSubmission {
  const commented =
    row.status === "rejected" || row.status === "needs_revision";
  return {
    id: row.id,
    eventId: row.eventId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    authors: row.authors,
    body: row.body,
    committeeComment: commented ? row.committeeComment : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    revisionDueAt: row.revisionDueAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  auditLedger,
  congressSubmissions,
  events,
  registrations,
  users,
  type CongressSubmissionRow,
  type DrizzleHandle,
} from "@ds/db";
import {
  CONGRESS_SUBMISSION_KIND_LABELS,
  type CongressCommitteeProblem,
  type CongressRevisionDeadlineRequest,
  type CongressSubmissionCard,
  type CongressSubmissionHistoryEntry,
  type CongressSubmissionRegistry,
  type CongressSubmissionRegistryQuery,
  type CongressSubmissionStatus,
  type CongressSubmissionStatusChangeRequest,
  congressAgeOnDay,
  congressStatusNeedsComment,
  instantToMskDay,
  isCongressCommitteeTransition,
  mskClosingInstantAfterLastDay,
  mskDayStartInstant,
  revisionDueAt,
  revisionExtensionDueAt,
  revisionLastDay,
} from "@ds/schemas";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import {
  MAILER,
  type CongressSubmissionDecisionRequest,
  type Mailer,
} from "../mailer/mailer.types.js";
import {
  CONGRESS_SIGN_UP_CLOCK,
  type CongressSignUpClock,
} from "./congress-signup.tokens.js";

type Db = DrizzleHandle["db"];

/** Canonical UUID shape — a non-uuid id names nothing (404, not a driver error). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A committee write refused for a stable, named reason. */
function conflict(problem: CongressCommitteeProblem): never {
  throw new ConflictException({ problems: [problem] });
}
function unprocessable(problem: CongressCommitteeProblem): never {
  throw new UnprocessableEntityException({ problems: [problem] });
}

/** `%term%` for ILIKE with the LIKE metacharacters escaped. */
function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * The submitter's cells, from the 044 answers of the registration that holds
 * the submission, with the account fallback — the same derivation the roster
 * and the participant card make (`registration.repository.ts`).
 */
const submitterFullName = sql<string>`coalesce(
  nullif(trim(concat_ws(' ',
    ${registrations.answers}->>'surname',
    ${registrations.answers}->>'firstName',
    ${registrations.answers}->>'patronymic'
  )), ''),
  nullif(trim(${users.displayName}), ''),
  ''
)`;
const submitterEmail = sql<
  string | null
>`coalesce(nullif(${registrations.answers}->>'email', ''), ${users.email})`;
const submitterPhone = sql<string | null>`coalesce(
  nullif(${registrations.answers}->>'contactPhone', ''),
  nullif(trim(${users.phone}), '')
)`;

/** The letter a committee status sends (EARS-29); `in_review` sends none. */
type DecisionLetter = "accepted" | "rejected" | "needs_revision";

/**
 * 046 EARS-26…EARS-29, EARS-34, EARS-35 (#2437) — the programme committee's
 * reads and writes over an event's congress submissions
 * (`apps/api/src/congress/README.md`, «Programme committee»).
 *
 * The caller has already passed the role check and the event-binding step
 * (`EventGrantPolicy`), so every method takes the resolved event key. Drafts
 * are excluded in every query (EARS-27). Every write runs in the request audit
 * context, so the 010 trigger records who changed the status and when — that
 * ledger is the card's status history (EARS-28). Letters go after commit, off
 * the response path, with the outcome recorded on the submission; a letter
 * failure never touches the status or the deadline (EARS-29, EARS-35).
 */
@Injectable()
export class CongressSubmissionsAdminService {
  private readonly logger = new Logger(CongressSubmissionsAdminService.name);

  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(CONGRESS_SIGN_UP_CLOCK) private readonly now: CongressSignUpClock,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  // ---------------------------------------------------------------- reads

  /** EARS-27 — one page of the event's registry; drafts never listed. */
  async registry(
    eventKey: string,
    query: CongressSubmissionRegistryQuery,
  ): Promise<CongressSubmissionRegistry> {
    const event = await this.event(eventKey);
    const where = and(
      eq(congressSubmissions.eventId, event.id),
      ne(congressSubmissions.status, "draft"),
      ...this.registryFilters(query),
    );
    const offset = (query.page - 1) * query.pageSize;
    const direction = query.order === "asc" ? asc : desc;
    const sortColumn: Record<typeof query.sort, SQL> = {
      kind: sql`${congressSubmissions.kind}`,
      title: sql`lower(${congressSubmissions.title})`,
      submitter: sql`lower(${submitterFullName})`,
      status: sql`${congressSubmissions.status}`,
      submittedAt: sql`${congressSubmissions.submittedAt}`,
      updatedAt: sql`${congressSubmissions.updatedAt}`,
    };
    const ordered = sortColumn[query.sort];

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          id: congressSubmissions.id,
          kind: congressSubmissions.kind,
          title: congressSubmissions.title,
          status: congressSubmissions.status,
          submittedAt: congressSubmissions.submittedAt,
          updatedAt: congressSubmissions.updatedAt,
          fullName: submitterFullName,
          email: submitterEmail,
        })
        .from(congressSubmissions)
        .innerJoin(users, eq(users.id, congressSubmissions.userId))
        .innerJoin(
          registrations,
          eq(registrations.id, congressSubmissions.registrationId),
        )
        .where(where)
        .orderBy(
          sql`${direction(ordered)} nulls last`,
          asc(congressSubmissions.id),
        )
        .limit(query.pageSize)
        .offset(offset),
      this.db
        .select({ n: count() })
        .from(congressSubmissions)
        .innerJoin(users, eq(users.id, congressSubmissions.userId))
        .innerJoin(
          registrations,
          eq(registrations.id, congressSubmissions.registrationId),
        )
        .where(where),
    ]);

    return {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
      },
      rows: rows.map((r, i) => ({
        id: r.id,
        position: offset + i + 1,
        kind: r.kind,
        title: r.title,
        submitter: { fullName: r.fullName, email: r.email ?? null },
        status: r.status as Exclude<CongressSubmissionStatus, "draft">,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: Number(totalRow?.n ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** EARS-28 — the card of one submission of the event; a draft is «not found». */
  async card(
    eventKey: string,
    submissionId: string,
  ): Promise<CongressSubmissionCard> {
    const event = await this.event(eventKey);
    if (!UUID_RE.test(submissionId)) {
      throw new NotFoundException("submission not found");
    }
    const [found] = await this.db
      .select({
        row: congressSubmissions,
        fullName: submitterFullName,
        email: submitterEmail,
        phone: submitterPhone,
        birthDate: users.birthDate,
      })
      .from(congressSubmissions)
      .innerJoin(users, eq(users.id, congressSubmissions.userId))
      .innerJoin(
        registrations,
        eq(registrations.id, congressSubmissions.registrationId),
      )
      .where(
        and(
          eq(congressSubmissions.id, submissionId),
          eq(congressSubmissions.eventId, event.id),
          ne(congressSubmissions.status, "draft"),
        ),
      )
      .limit(1);
    if (!found) throw new NotFoundException("submission not found");
    const row = found.row;

    const [source] = row.derivedFromId
      ? await this.db
          .select({
            id: congressSubmissions.id,
            kind: congressSubmissions.kind,
            title: congressSubmissions.title,
            status: congressSubmissions.status,
          })
          .from(congressSubmissions)
          // The link is shown only within the card's own event and never to a
          // draft (EARS-27): a source returned to `draft` or living in another
          // event reads as no link rather than leaking its title.
          .where(
            and(
              eq(congressSubmissions.id, row.derivedFromId),
              eq(congressSubmissions.eventId, event.id),
              ne(congressSubmissions.status, "draft"),
            ),
          )
          .limit(1)
      : [];

    const commented =
      row.status === "rejected" || row.status === "needs_revision";
    const ageOnEventStart =
      row.kind === "poster" && found.birthDate
        ? congressAgeOnDay(found.birthDate, instantToMskDay(event.startsAt))
        : null;
    const lastLetter =
      row.lastLetterKind && row.lastLetterStatus && row.lastLetterAt
        ? {
            kind: row.lastLetterKind,
            status: row.lastLetterStatus as "sent" | "failed",
            at: row.lastLetterAt.toISOString(),
          }
        : null;
    const due = row.status === "needs_revision" ? row.revisionDueAt : null;

    return {
      id: row.id,
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
      },
      kind: row.kind,
      status: row.status as Exclude<CongressSubmissionStatus, "draft">,
      title: row.title,
      authors: row.authors,
      body: row.body,
      statements: row.statements,
      derivedFrom: source ?? null,
      committeeComment: commented ? row.committeeComment : null,
      submitter: {
        fullName: found.fullName,
        email: found.email ?? null,
        phone: found.phone ?? null,
        ageOnEventStart,
      },
      submittedAt: row.submittedAt?.toISOString() ?? null,
      statusChangedAt: row.statusChangedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      revisionDueAt: due?.toISOString() ?? null,
      revisionLastDay: due ? revisionLastDay(due) : null,
      lastLetter,
      history: await this.history(row),
    };
  }

  // ---------------------------------------------------------------- writes

  /**
   * EARS-28, EARS-34 — the committee's status change, conditional on the
   * status the member saw. `needs_revision` sets the submission's own revision
   * deadline in the same transaction (EARS-34). The letter of `accepted`,
   * `rejected` and `needs_revision` goes after commit (EARS-29).
   */
  async changeStatus(
    eventKey: string,
    submissionId: string,
    request: CongressSubmissionStatusChangeRequest,
  ): Promise<CongressSubmissionCard> {
    const event = await this.event(eventKey);
    const changed = await withRequestAuditContext(this.db, async (tx) => {
      const row = await this.lockedRow(tx, event.id, submissionId);
      if (row.status !== request.expectedStatus) {
        conflict({ code: "status-conflict", params: { status: row.status } });
      }
      if (!isCongressCommitteeTransition(row.status, request.status)) {
        conflict({
          code: "transition-not-allowed",
          params: { from: row.status, to: request.status },
        });
      }
      const target = request.status;
      const [updated] = await tx
        .update(congressSubmissions)
        .set({
          status: target,
          committeeComment: congressStatusNeedsComment(target)
            ? (request.comment ?? null)
            : null,
          revisionDueAt:
            target === "needs_revision" ? revisionDueAt(this.now()) : null,
          statusChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.status, row.status),
          ),
        )
        .returning();
      if (!updated) {
        conflict({ code: "status-conflict", params: { status: row.status } });
      }
      return updated;
    });

    // The transaction has COMMITTED; the letter is started and never awaited.
    if (changed.status !== "in_review") {
      this.dispatchLetter(changed.id, changed.status as DecisionLetter);
    }
    return this.card(event.id, changed.id);
  }

  /**
   * EARS-35 — the platform administrator's extension of a `needs_revision`
   * submission's deadline to a later Moscow last day, stored as 00:00 Moscow of
   * the following day; the extension letter goes after commit.
   */
  async extendRevisionDeadline(
    eventKey: string,
    submissionId: string,
    request: CongressRevisionDeadlineRequest,
  ): Promise<CongressSubmissionCard> {
    const event = await this.event(eventKey);
    const extended = await withRequestAuditContext(this.db, async (tx) => {
      const row = await this.lockedRow(tx, event.id, submissionId);
      if (row.status !== "needs_revision") {
        conflict({
          code: "not-needs-revision",
          params: { status: row.status },
        });
      }
      const current = row.revisionDueAt
        ? revisionLastDay(row.revisionDueAt)
        : null;
      if (current !== null && request.lastDay <= current) {
        unprocessable({
          code: "revision-day-not-later",
          params: { currentLastDay: current },
        });
      }
      const today = instantToMskDay(this.now());
      if (request.lastDay < today) {
        unprocessable({ code: "revision-day-in-past", params: { today } });
      }
      const [updated] = await tx
        .update(congressSubmissions)
        .set({
          revisionDueAt: revisionExtensionDueAt(request.lastDay),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(congressSubmissions.id, row.id),
            eq(congressSubmissions.status, "needs_revision"),
          ),
        )
        .returning();
      if (!updated) {
        conflict({
          code: "not-needs-revision",
          params: { status: row.status },
        });
      }
      return updated;
    });

    this.dispatchLetter(extended.id, "revision_extended");
    return this.card(event.id, extended.id);
  }

  // ---------------------------------------------------------------- helpers

  /** The event by id or slug; 404 for an unknown one. */
  private async event(key: string) {
    const [event] = await this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        startsAt: events.startsAt,
      })
      .from(events)
      .where(
        UUID_RE.test(key)
          ? or(eq(events.id, key), eq(events.slug, key))
          : eq(events.slug, key),
      )
      .limit(1);
    if (!event) throw new NotFoundException("event not found");
    return event;
  }

  /** The submission row under a row lock; a draft or another event's row is «not found». */
  private async lockedRow(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    eventId: string,
    submissionId: string,
  ): Promise<CongressSubmissionRow> {
    if (!UUID_RE.test(submissionId)) {
      throw new NotFoundException("submission not found");
    }
    const [row] = await tx
      .select()
      .from(congressSubmissions)
      .where(
        and(
          eq(congressSubmissions.id, submissionId),
          eq(congressSubmissions.eventId, eventId),
          ne(congressSubmissions.status, "draft"),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw new NotFoundException("submission not found");
    return row;
  }

  /** The EARS-27 filters, each composable with the others and the page. */
  private registryFilters(query: CongressSubmissionRegistryQuery): SQL[] {
    const filters: SQL[] = [];
    if (query.kind) filters.push(eq(congressSubmissions.kind, query.kind));
    if (query.status)
      filters.push(eq(congressSubmissions.status, query.status));
    if (query.sentFrom) {
      filters.push(
        gte(
          congressSubmissions.submittedAt,
          mskDayStartInstant(query.sentFrom),
        ),
      );
    }
    if (query.sentTo) {
      filters.push(
        lt(
          congressSubmissions.submittedAt,
          mskClosingInstantAfterLastDay(query.sentTo),
        ),
      );
    }
    const submitter = query.submitter?.trim();
    if (submitter) {
      filters.push(
        sql`concat_ws(' ', ${submitterFullName}, ${submitterEmail}) ilike ${containsPattern(submitter)} escape '\\'`,
      );
    }
    const q = query.q?.trim();
    if (q) {
      const pattern = containsPattern(q);
      filters.push(
        sql`(${congressSubmissions.title} ilike ${pattern} escape '\\' or exists (
          select 1 from jsonb_array_elements(${congressSubmissions.authors}) as author
          where concat_ws(' ', author->>'surname', author->>'firstName', author->>'patronymic')
            ilike ${pattern} escape '\\'
        ))`,
      );
    }
    return filters;
  }

  /**
   * EARS-28 — the status history from the 010 change audit: the
   * `audit_row_change()` rows of this submission whose diff carries `status`,
   * oldest first, with who (display name, else email; an actor with no
   * account row reads as unknown — the raw IdP subject is never exposed)
   * and the write door. `created_at >= the row's creation` lets Postgres prune
   * older monthly partitions.
   */
  private async history(
    row: CongressSubmissionRow,
  ): Promise<CongressSubmissionHistoryEntry[]> {
    const rows = await this.db
      .select({
        from: sql<
          string | null
        >`${auditLedger.metadata}->'diff'->'status'->>'old'`,
        to: sql<string>`${auditLedger.metadata}->'diff'->'status'->>'new'`,
        at: auditLedger.createdAt,
        actor: sql<
          string | null
        >`coalesce(nullif(trim(${users.displayName}), ''), ${users.email}::text)`,
        source: sql<string>`coalesce(${auditLedger.metadata}->>'source', 'db-direct')`,
      })
      .from(auditLedger)
      .leftJoin(users, eq(users.zitadelSub, auditLedger.subjectId))
      .where(
        and(
          sql`${auditLedger.metadata}->>'table' = 'congress_submissions'`,
          sql`${auditLedger.metadata}->'pk'->>'id' = ${row.id}`,
          sql`${auditLedger.metadata}->'diff' ? 'status'`,
          gte(auditLedger.createdAt, row.createdAt),
        ),
      )
      .orderBy(asc(auditLedger.createdAt), asc(auditLedger.id));
    return rows
      .filter((r) => r.to !== null)
      .map((r) => ({
        from: (r.from ?? null) as CongressSubmissionStatus | null,
        to: r.to as CongressSubmissionStatus,
        at: r.at.toISOString(),
        actor: r.actor ?? null,
        source: r.source,
      }));
  }

  /**
   * EARS-29, EARS-35 — the author's letter, sent off the response path with
   * the outcome recorded on the submission (`last_letter_*`). The pattern of
   * the EARS-14 receipt: started, never awaited; built from the committed row
   * read back; a relay rejection becomes `failed` and never touches the status
   * or the deadline; the outer `catch` keeps an unrecordable outcome from
   * becoming an unhandled rejection.
   */
  private dispatchLetter(
    submissionId: string,
    letter: DecisionLetter | "revision_extended",
  ): void {
    void (async () => {
      try {
        const [row] = await this.db
          .select({
            email: users.email,
            title: congressSubmissions.title,
            kind: congressSubmissions.kind,
            comment: congressSubmissions.committeeComment,
            revisionDueAt: congressSubmissions.revisionDueAt,
          })
          .from(congressSubmissions)
          .innerJoin(users, eq(users.id, congressSubmissions.userId))
          .where(eq(congressSubmissions.id, submissionId))
          .limit(1);
        if (!row) return;

        const named = {
          email: row.email ?? "",
          title: row.title,
          kindLabel: CONGRESS_SUBMISSION_KIND_LABELS[row.kind],
        };
        let request: CongressSubmissionDecisionRequest;
        switch (letter) {
          case "accepted":
            request = { ...named, letter };
            break;
          case "rejected":
            request = { ...named, letter, comment: row.comment ?? "" };
            break;
          case "needs_revision":
            request = {
              ...named,
              letter,
              comment: row.comment ?? "",
              revisionDueAt: row.revisionDueAt!,
            };
            break;
          case "revision_extended":
            request = { ...named, letter, revisionDueAt: row.revisionDueAt! };
            break;
        }

        let status: "sent" | "failed" = "sent";
        try {
          await this.mailer.sendCongressSubmissionDecision(request);
        } catch {
          // The mailer's own diagnostics carry the sanitized provider outcome;
          // re-logging the error could put the recipient address in a log line.
          status = "failed";
          this.logger.warn(
            `congress submission ${letter} letter rejected for submission ${submissionId}`,
          );
        }

        await withRequestAuditContext(this.db, (tx) =>
          tx
            .update(congressSubmissions)
            .set({
              lastLetterKind: letter,
              lastLetterStatus: status,
              lastLetterAt: new Date(),
            })
            .where(eq(congressSubmissions.id, submissionId)),
        );
      } catch {
        this.logger.warn(
          `congress submission ${letter} letter outcome could not be recorded for submission ${submissionId}`,
        );
      }
    })();
  }
}

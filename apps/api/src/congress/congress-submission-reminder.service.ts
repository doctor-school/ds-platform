import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { DrizzleHandle } from "@ds/db";
import {
  congressSubmissionKindSettings,
  congressSubmissions,
  users,
} from "@ds/db";
import {
  CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL,
  type CongressSubmissionKind,
} from "@ds/schemas";
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { MAILER, type Mailer } from "../mailer/mailer.types.js";
import {
  CONGRESS_SIGN_UP_CLOCK,
  type CongressSignUpClock,
} from "./congress-signup.tokens.js";

type Db = DrizzleHandle["db"];

/** The name the sweep's cron job is registered under (`SchedulerRegistry`). */
export const CONGRESS_SUBMISSION_REMINDER_JOB = "congress-submission-reminder";

/** EARS-33 — a kind is reminded of when it closes within this horizon. */
const REMINDER_HORIZON_MS = 72 * 60 * 60 * 1000;

type ClaimedDraft = {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  /** The kind's closing instant the claim bound to — the letter's date. */
  closesAt: Date;
};

/**
 * 046 EARS-33 — the deadline reminder (046-design «Deadline sweep»).
 *
 * Every 15 minutes the sweep takes each OPEN kind whose closing instant falls
 * within the next 72 hours, claims that kind's active drafts with one
 * conditional update — `reminded_for_closes_at` is set to the closing instant
 * where it still differs, and only for accounts none of whose rows of that
 * event and kind already carries it — and sends each claiming account one
 * letter listing its claimed drafts. The conditional update is the
 * idempotency: a second run or a parallel API instance claims nothing (the
 * row lock serialises the two updates and the loser's re-check fails); a
 * draft added after the reminder is not reminded again for the same instant;
 * a moved closing instant re-arms every draft, because the stored value no
 * longer matches.
 *
 * The letter goes after the claim commits and its outcome is recorded on every
 * listed draft (`last_letter_kind = 'reminder'`, status, instant), like the
 * receipt; a relay failure becomes `failed` and never touches the status. No
 * retry queue (design «Letters»): the section always shows the status.
 */
@Injectable()
export class CongressSubmissionReminderService {
  private readonly logger = new Logger(CongressSubmissionReminderService.name);

  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(CONGRESS_SIGN_UP_CLOCK) private readonly now: CongressSignUpClock,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** The scheduled tick: one sweep, never an unhandled rejection. */
  @Cron("0 */15 * * * *", { name: CONGRESS_SUBMISSION_REMINDER_JOB })
  async sweep(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(
        "congress submission reminder sweep failed",
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * One sweep over every open kind closing within 72 hours (EARS-33). Each
   * (event, kind) is isolated: a failure while claiming or reminding one is
   * logged and the sweep goes on with the rest, earliest closing first.
   */
  async runOnce(): Promise<void> {
    const now = this.now();
    const horizon = new Date(now.getTime() + REMINDER_HORIZON_MS);
    const closing = await this.db
      .select({
        eventId: congressSubmissionKindSettings.eventId,
        kind: congressSubmissionKindSettings.kind,
      })
      .from(congressSubmissionKindSettings)
      .where(this.closingWithin(now, horizon))
      .orderBy(
        asc(congressSubmissionKindSettings.closesAt),
        asc(congressSubmissionKindSettings.eventId),
        asc(congressSubmissionKindSettings.kind),
      );

    for (const { eventId, kind } of closing) {
      try {
        const claimed = await this.claim(eventId, kind, now, horizon);
        await this.remind(kind, claimed);
      } catch (err) {
        this.logger.error(
          `congress submission reminder failed for event ${eventId}, kind ${kind}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  /** An open kind whose closing instant falls within (now, horizon]. */
  private closingWithin(now: Date, horizon: Date) {
    const k = congressSubmissionKindSettings;
    return and(
      isNotNull(k.opensAt),
      lte(k.opensAt, now),
      gt(k.closesAt, now),
      lte(k.closesAt, horizon),
    );
  }

  /**
   * The conditional update that makes the reminder at-most-once. It joins the
   * kind's settings row in the same statement, so the claim binds to the
   * kind's CURRENT closing instant (and to the kind still being open and due)
   * — never to a value read earlier — and returns that instant with each
   * claimed draft for the letter to name.
   */
  private claim(
    eventId: string,
    kind: CongressSubmissionKind,
    now: Date,
    horizon: Date,
  ): Promise<ClaimedDraft[]> {
    const s = congressSubmissions;
    const k = congressSubmissionKindSettings;
    return withRequestAuditContext(this.db, (tx) =>
      tx
        .update(s)
        .set({ remindedForClosesAt: sql`${k.closesAt}` })
        .from(k)
        .where(
          and(
            eq(k.eventId, s.eventId),
            eq(k.kind, s.kind),
            this.closingWithin(now, horizon),
            eq(s.eventId, eventId),
            eq(s.kind, kind),
            eq(s.status, "draft"),
            eq(s.recordStatus, "active"),
            sql`${s.remindedForClosesAt} IS DISTINCT FROM ${k.closesAt}`,
            sql`NOT EXISTS (
              SELECT 1 FROM congress_submissions AS reminded
               WHERE reminded.user_id = ${s.userId}
                 AND reminded.event_id = ${s.eventId}
                 AND reminded.kind = ${s.kind}
                 AND reminded.reminded_for_closes_at = ${k.closesAt}
            )`,
          ),
        )
        .returning({
          id: s.id,
          userId: s.userId,
          title: s.title,
          createdAt: s.createdAt,
          closesAt: k.closesAt,
        }),
    ).then((rows) =>
      rows.flatMap((r) =>
        r.closesAt === null ? [] : [{ ...r, closesAt: r.closesAt }],
      ),
    );
  }

  /**
   * One letter per claiming account; the outcome on each listed draft. When
   * the recipients cannot be read after the claim committed, every claimed
   * draft records `failed`, so no claimed draft is left without an outcome.
   */
  private async remind(
    kind: CongressSubmissionKind,
    claimed: ClaimedDraft[],
  ): Promise<void> {
    if (claimed.length === 0) return;
    const byAccount = new Map<string, ClaimedDraft[]>();
    for (const draft of claimed) {
      const drafts = byAccount.get(draft.userId) ?? [];
      drafts.push(draft);
      byAccount.set(draft.userId, drafts);
    }
    let emailOf: Map<string, string | null>;
    try {
      const accounts = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, [...byAccount.keys()]));
      emailOf = new Map(accounts.map((a) => [a.id, a.email]));
    } catch (err) {
      await this.recordOutcome(
        claimed.map((d) => d.id),
        "failed",
      );
      throw err;
    }

    for (const [userId, drafts] of byAccount) {
      drafts.sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      let status: "sent" | "failed" = "sent";
      try {
        await this.mailer.sendCongressSubmissionReminder({
          email: emailOf.get(userId) ?? "",
          kindGenitivePlural: CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL[kind],
          titles: drafts.map((d) => d.title),
          closesAt: drafts[0]!.closesAt,
        });
      } catch {
        // The mailer's own diagnostics carry the sanitized provider outcome;
        // re-logging the error could put the recipient address in a log line.
        status = "failed";
        this.logger.warn(
          `congress submission reminder rejected for account ${userId}`,
        );
      }
      await this.recordOutcome(
        drafts.map((d) => d.id),
        status,
      );
    }
  }

  /** The letter's outcome on the listed drafts; a write failure is logged. */
  private async recordOutcome(
    ids: string[],
    status: "sent" | "failed",
  ): Promise<void> {
    try {
      await withRequestAuditContext(this.db, (tx) =>
        tx
          .update(congressSubmissions)
          .set({
            lastLetterKind: "reminder",
            lastLetterStatus: status,
            lastLetterAt: new Date(),
          })
          .where(inArray(congressSubmissions.id, ids)),
      );
    } catch {
      this.logger.warn(
        `congress submission reminder outcome could not be recorded for ${ids.length} draft(s)`,
      );
    }
  }
}

import { Inject, Injectable } from "@nestjs/common";
import {
  applicationNotes,
  applications,
  consentRecords,
  type DrizzleHandle,
  specialtiesMinzdrav,
  users,
} from "@ds/db";
import {
  type AdminApplicationDetail,
  AdminApplicationErrorCodes,
  type AdminApplicationListPage,
  type AdminApplicationListQuery,
  type AdminApplicationNote,
  type AdminApplicationStatusMove,
  type ApplicationKind,
  type ApplicationOutcome,
  type ApplicationStatus,
  taxonomyETag,
} from "@ds/schemas";
import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  type AuditedTransaction,
  withRequestAuditContext,
} from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { markReplayable, TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { adminViewOf } from "./applications.admin-view.js";
import { ApplicationAdminError } from "./applications.admin.errors.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";
import { eraseApplication } from "./applications.service.js";
import {
  APPLICATIONS_CLOCK,
  type ApplicationsClock,
} from "./applications.tokens.js";

type Db = DrizzleHandle["db"];
type Reader = AuditedTransaction | Db;

/** EARS-15 — the only status moves an administrator may make. */
const ALLOWED_MOVES: Readonly<Record<ApplicationStatus, readonly string[]>> = {
  new: ["in_review", "closed"],
  in_review: ["closed"],
  closed: [],
};

// ── the opaque list cursor: (submitted_at, id) of a page's last row ────────
//
// `submitted_at` travels as Postgres's own microsecond UTC text (a JS Date
// keeps milliseconds only), so the keyset `(submitted_at, id) < cursor` never
// skips or repeats a row sharing a millisecond with the page boundary — the
// 025 `points-history-cursor.ts` precedent.

const MICRO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CursorSchema = z.tuple([z.string().regex(MICRO_UTC), z.uuid()]);

function encodeCursor(submittedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([submittedAt, id]), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const parsed = CursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const submittedAtMicro = sql<string>`to_char(${applications.submittedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function kindLabel(kind: string): string {
  return (
    (APPLICATION_KIND_TABLE as Record<string, { label: string }>)[kind]
      ?.label ?? kind
  );
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function notFound(): TaxonomyError {
  return new TaxonomyError("RESOURCE_NOT_FOUND");
}

/**
 * 033 EARS-13…EARS-17, EARS-20 — the admin «Заявки» reads and commands over
 * the shared queue (033-design «Endpoints», «Lifecycle»).
 *
 * The applicant of an author application is read LIVE from the account on
 * every read (decision 17); nothing is copied. Every command runs in the
 * request audit context under the application's row lock and completes its
 * 012 idempotency record in the same transaction, so the 010 trigger
 * attributes the change to the acting administrator and an exact retry
 * replays the stored answer.
 */
@Injectable()
export class ApplicationsAdminService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: ApplicationsClock,
  ) {}

  /** EARS-13 — newest first by (`submitted_at`, `id`), kind/status filters. */
  async list(
    query: AdminApplicationListQuery,
  ): Promise<AdminApplicationListPage> {
    const where: SQL[] = [];
    if (query.kind) where.push(eq(applications.kind, query.kind));
    if (query.status) where.push(eq(applications.status, query.status));
    if (query.cursor !== undefined) {
      const position = decodeCursor(query.cursor);
      if (!position)
        throw new TaxonomyError(
          "CURSOR_INVALID",
          "the cursor is not one this route issued",
        );
      where.push(
        sql`(${applications.submittedAt}, ${applications.id}) < (${position[0]}::timestamptz, ${position[1]}::uuid)`,
      );
    }
    const rows = await this.db
      .select({
        id: applications.id,
        kind: applications.kind,
        submittedAt: applications.submittedAt,
        submittedAtMicro,
        contact: applications.contact,
        subjectLine: applications.subjectLine,
        status: applications.status,
        outcome: applications.outcome,
        teamNotice: applications.teamNotice,
        pdErasedAt: applications.pdErasedAt,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone,
      })
      .from(applications)
      .leftJoin(users, eq(users.id, applications.applicantUserId))
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(applications.submittedAt), desc(applications.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const erased = r.pdErasedAt !== null;
        const view = adminViewOf(r.kind);
        const applicant = erased
          ? null
          : r.contact !== null
            ? (view?.contactName(r.contact as never) ?? null)
            : (r.displayName ?? r.email ?? r.phone ?? null);
        return {
          id: r.id,
          kind: r.kind as ApplicationKind,
          kindLabel: kindLabel(r.kind),
          submittedAt: r.submittedAt.toISOString(),
          applicant,
          subjectLine: erased ? null : r.subjectLine,
          status: r.status as ApplicationStatus,
          outcome: r.outcome as ApplicationOutcome | null,
          teamNotified: r.teamNotice === "sent",
          erased,
        };
      }),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.submittedAtMicro, last.id)
          : null,
    };
  }

  /** EARS-14 — the detail with the account's current contact and the notes. */
  async detail(
    id: string,
  ): Promise<{ detail: AdminApplicationDetail; etag: string }> {
    const detail = await this.load(this.db, id);
    if (!detail) throw notFound();
    return { detail, etag: taxonomyETag(detail.version) };
  }

  /**
   * EARS-15 — move the status under `If-Match`: only `new → in_review`,
   * `new → closed`, `in_review → closed`; the outcome is already bound to a
   * `closed` target by the body schema. The actor and the time are stored on
   * the row; the 010 trigger records the change.
   */
  async moveStatus(input: {
    id: string;
    move: AdminApplicationStatusMove;
    expectedVersion: number;
    actorSub: string | null;
    lease: IdempotencyLease;
  }): Promise<{ detail: AdminApplicationDetail; etag: string }> {
    return this.command(input.lease, async (tx) => {
      const locked = await this.lock(tx, input.id);
      if (locked.version !== input.expectedVersion)
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the application changed since it was read; reload and retry",
        );
      if (
        !ALLOWED_MOVES[locked.status as ApplicationStatus]?.includes(
          input.move.status,
        )
      )
        throw new ApplicationAdminError(
          AdminApplicationErrorCodes.transitionNotAllowed,
          `an application cannot move from ${locked.status} to ${input.move.status}`,
        );
      const now = this.clock();
      const closing = input.move.status === "closed";
      await tx
        .update(applications)
        .set({
          status: input.move.status,
          outcome: closing ? (input.move.outcome ?? null) : null,
          closedAt: closing ? now : null,
          statusChangedAt: now,
          statusChangedBy: await this.adminUserId(tx, input.actorSub),
          version: sql`${applications.version} + 1`,
        })
        .where(eq(applications.id, input.id));
      return this.respond(tx, input.id, input.lease, 200);
    });
  }

  /**
   * EARS-16 — append one immutable note (the body arrives trimmed 1–2000).
   * An erased application takes no new note: its personal data is gone and
   * a note written after the erasure would never be erased (EARS-20).
   */
  async addNote(input: {
    id: string;
    body: string;
    actorSub: string | null;
    lease: IdempotencyLease;
  }): Promise<AdminApplicationNote> {
    return this.command(input.lease, async (tx) => {
      const locked = await this.lock(tx, input.id);
      if (locked.pdErasedAt !== null)
        throw new ApplicationAdminError(
          AdminApplicationErrorCodes.alreadyErased,
          "the application's personal data is erased; it takes no new note",
        );
      const authorAdminId = await this.adminUserId(tx, input.actorSub);
      const [created] = await tx
        .insert(applicationNotes)
        .values({
          applicationId: input.id,
          authorAdminId,
          body: input.body,
          createdAt: this.clock(),
        })
        .returning();
      const [author] = await tx
        .select({ displayName: users.displayName, email: users.email })
        .from(users)
        .where(eq(users.id, authorAdminId))
        .limit(1);
      const note: AdminApplicationNote = {
        id: created!.id,
        body: created!.body,
        authorAdminId,
        authorName: author?.displayName ?? author?.email ?? null,
        createdAt: created!.createdAt.toISOString(),
      };
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: note,
      });
      return note;
    });
  }

  /**
   * EARS-20 — «Стереть персональные данные заявителя» on the subject's
   * request: the core's tombstone, in any status; a second erasure is
   * `409 ALREADY_ERASED`.
   */
  async erase(input: {
    id: string;
    lease: IdempotencyLease;
  }): Promise<{ detail: AdminApplicationDetail; etag: string }> {
    return this.command(input.lease, async (tx) => {
      const locked = await this.lock(tx, input.id);
      if (
        locked.pdErasedAt !== null ||
        !(await eraseApplication(tx, input.id, this.clock()))
      )
        throw new ApplicationAdminError(
          AdminApplicationErrorCodes.alreadyErased,
          "the application's personal data is already erased",
        );
      return this.respond(tx, input.id, input.lease, 200);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async command<T>(
    lease: IdempotencyLease,
    run: (tx: AuditedTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await withRequestAuditContext(this.db, run);
    } catch (err) {
      if (err instanceof ApplicationAdminError) {
        err.replayLease = lease;
        throw err;
      }
      throw markReplayable(err, lease);
    }
  }

  private async lock(tx: AuditedTransaction, id: string) {
    const [locked] = await tx
      .select({
        status: applications.status,
        version: applications.version,
        pdErasedAt: applications.pdErasedAt,
      })
      .from(applications)
      .where(eq(applications.id, id))
      .for("update");
    if (!locked) throw notFound();
    return locked;
  }

  private async respond(
    tx: AuditedTransaction,
    id: string,
    lease: IdempotencyLease,
    status: number,
  ): Promise<{ detail: AdminApplicationDetail; etag: string }> {
    const detail = (await this.load(tx, id))!;
    const etag = taxonomyETag(detail.version);
    await this.idempotency.complete(tx, lease, { status, body: detail, etag });
    return { detail, etag };
  }

  /** The acting administrator's account id (status mover, note author). */
  private async adminUserId(tx: Reader, sub: string | null): Promise<string> {
    const [user] = sub
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.zitadelSub, sub))
          .limit(1)
      : [];
    if (!user) throw new TaxonomyError("ADMIN_SESSION_REQUIRED");
    return user.id;
  }

  private async load(
    q: Reader,
    id: string,
  ): Promise<AdminApplicationDetail | null> {
    const [r] = await q
      .select({
        app: applications,
        capturedAt: consentRecords.capturedAt,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone,
      })
      .from(applications)
      .leftJoin(users, eq(users.id, applications.applicantUserId))
      .leftJoin(
        consentRecords,
        eq(consentRecords.id, applications.consentRecordId),
      )
      .where(eq(applications.id, id))
      .limit(1);
    if (!r) return null;
    const a = r.app;
    const erased = a.pdErasedAt !== null;
    const view = adminViewOf(a.kind);

    let fields: AdminApplicationDetail["fields"] = [];
    if (!erased && view) {
      const payload = a.payload as { specialtyCode?: string };
      let specialtyName: string | null = null;
      if (typeof payload.specialtyCode === "string") {
        const [s] = await q
          .select({ name: specialtiesMinzdrav.name })
          .from(specialtiesMinzdrav)
          .where(eq(specialtiesMinzdrav.code, payload.specialtyCode))
          .limit(1);
        specialtyName = s?.name ?? null;
      }
      fields = view.fields(a.payload as never, { specialtyName });
    }

    let applicant: AdminApplicationDetail["applicant"] = null;
    if (!erased) {
      if (a.applicantUserId !== null)
        applicant = {
          type: "account",
          userId: a.applicantUserId,
          displayName: r.displayName ?? null,
          email: r.email ?? null,
          phone: r.phone ?? null,
        };
      else if (a.contact !== null && view)
        applicant = {
          type: "contact",
          fields: view.contactFields(a.contact as never),
        };
    }

    const notes = await q
      .select({
        id: applicationNotes.id,
        body: applicationNotes.body,
        authorAdminId: applicationNotes.authorAdminId,
        createdAt: applicationNotes.createdAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(applicationNotes)
      .leftJoin(users, eq(users.id, applicationNotes.authorAdminId))
      .where(eq(applicationNotes.applicationId, id))
      .orderBy(asc(applicationNotes.createdAt), asc(applicationNotes.id));

    const others =
      a.applicantUserId === null
        ? []
        : await q
            .select({
              id: applications.id,
              kind: applications.kind,
              submittedAt: applications.submittedAt,
              status: applications.status,
              outcome: applications.outcome,
              pdErasedAt: applications.pdErasedAt,
            })
            .from(applications)
            .where(
              and(
                eq(applications.applicantUserId, a.applicantUserId),
                ne(applications.id, id),
              ),
            )
            .orderBy(desc(applications.submittedAt), desc(applications.id));

    return {
      id: a.id,
      kind: a.kind as ApplicationKind,
      kindLabel: kindLabel(a.kind),
      submittedAt: a.submittedAt.toISOString(),
      subjectLine: erased ? null : a.subjectLine,
      fields,
      applicant,
      consent: {
        purpose: a.consentPurpose,
        versionTag: a.consentVersionTag,
        capturedAt: iso(r.capturedAt ?? null),
      },
      teamNotice: a.teamNotice as AdminApplicationDetail["teamNotice"],
      receiptNotice: a.receiptNotice as AdminApplicationDetail["receiptNotice"],
      status: a.status as ApplicationStatus,
      outcome: a.outcome as ApplicationOutcome | null,
      statusChangedAt: iso(a.statusChangedAt),
      statusChangedBy: a.statusChangedBy,
      closedAt: iso(a.closedAt),
      erased,
      pdErasedAt: iso(a.pdErasedAt),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorAdminId: n.authorAdminId,
        authorName: n.displayName ?? n.email ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      otherApplications: others.map((o) => ({
        id: o.id,
        kind: o.kind as ApplicationKind,
        submittedAt: o.submittedAt.toISOString(),
        status: o.status as ApplicationStatus,
        outcome: o.outcome as ApplicationOutcome | null,
        erased: o.pdErasedAt !== null,
      })),
      version: a.version,
    };
  }
}

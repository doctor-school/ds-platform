import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import {
  auditLedger,
  events,
  insertEventGrant,
  listEventGrantsForUserRole,
  listStaffEventBindings,
  users,
  type DrizzleHandle,
  type EventGrantBinding,
  type EventScopedRole,
  type StaffEventBinding,
} from "@ds/db";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { toLedgerRow } from "../auth/session/auth-audit.ledger.js";

type Db = DrizzleHandle["db"];

/** 044 EARS-38's partial unique index: one `event-registrar` binding per user. */
const REGISTRAR_ONE_EVENT_INDEX = "event_role_grants_registrar_user_uniq";

/**
 * Whether `error` (or a `cause` up its chain — drizzle wraps the pg error) is
 * the unique violation of {@link REGISTRAR_ONE_EVENT_INDEX}: a registrar
 * binding to another event landed after the grant's completeness read. The
 * constraint name is read from the structured field, else from the message
 * (the precedent of `taxonomy.errors.ts` `asSlotConflict`).
 */
export function isRegistrarBindingConflict(error: unknown): boolean {
  for (let node: unknown = error, depth = 0; node && depth < 5; depth += 1) {
    const candidate = node as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505") {
      return (
        candidate.constraint === REGISTRAR_ONE_EVENT_INDEX ||
        (typeof candidate.message === "string" &&
          candidate.message.includes(REGISTRAR_ONE_EVENT_INDEX))
      );
    }
    node = candidate.cause;
  }
  return false;
}

/** The `users` mirror row a grant reads and writes (047-design §Grant cascade). */
export interface StaffMirrorRow {
  id: string;
  zitadelSub: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

/** What the grant's one DB transaction commits (047-design → write step 3). */
export interface GrantCommit {
  sub: string;
  email: string;
  fullName: string;
  /** `users.role` — `mirrorRoleFromClaims` of the account's role set after the grant. */
  mirrorRole: string;
  role: string;
  eventId: string | null;
  byAdmin: string;
}

type RoleEventType = "auth.role.granted" | "auth.role.revoked";

/**
 * The latest `auth.role.*` row for (person, role, event) — read inside the
 * caller's transaction when it decides whether to append the mark.
 */
async function latestRoleEventIn(
  db: Pick<Db, "select">,
  sub: string,
  role: string,
  eventId: string | null,
): Promise<RoleEventType | null> {
  const [row] = await db
    .select({ eventType: auditLedger.eventType })
    .from(auditLedger)
    .where(
      and(
        eq(auditLedger.subjectId, sub),
        like(auditLedger.eventType, "auth.role.%"),
        sql`${auditLedger.metadata}->>'role' = ${role}`,
        eventId === null
          ? sql`${auditLedger.metadata}->>'event_id' IS NULL`
          : sql`${auditLedger.metadata}->>'event_id' = ${eventId}`,
      ),
    )
    .orderBy(desc(auditLedger.createdAt))
    .limit(1);
  const type = row?.eventType;
  return type === "auth.role.granted" || type === "auth.role.revoked"
    ? type
    : null;
}

/** The mask `toLedgerRow` needs for identifier-keyed rows; a role row carries none. */
function noIdentifier(): string {
  throw new Error("a staff-access audit row carries no identifier to mask");
}

/**
 * 047 — the Postgres half of «Доступы»: the `users` mirror, the
 * `event_role_grants` bindings and the `auth.role.*` completion marks in
 * `audit_ledger`. No new table (047-design §Work-package map).
 */
@Injectable()
export class StaffAccessRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async findEvent(
    eventId: string,
  ): Promise<{ id: string; title: string } | undefined> {
    const [row] = await this.db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    return row;
  }

  async findMirrorBySub(sub: string): Promise<StaffMirrorRow | undefined> {
    const [row] = await this.db
      .select({
        id: users.id,
        zitadelSub: users.zitadelSub,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row;
  }

  async findMirrorsBySubs(subs: readonly string[]): Promise<StaffMirrorRow[]> {
    if (subs.length === 0) return [];
    return this.db
      .select({
        id: users.id,
        zitadelSub: users.zitadelSub,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(inArray(users.zitadelSub, [...subs]));
  }

  listBindings(
    userId: string,
    role: EventScopedRole,
  ): Promise<EventGrantBinding[]> {
    return listEventGrantsForUserRole(this.db, userId, role);
  }

  listAllBindings(): Promise<StaffEventBinding[]> {
    return listStaffEventBindings(this.db);
  }

  /**
   * The latest `auth.role.*` row for (person, role, event) — the completion mark
   * of 047-design §Completeness and retry. `null` when none was ever written
   * (e.g. a role granted by the runbook before the section existed).
   */
  async latestRoleEvent(
    sub: string,
    role: string,
    eventId: string | null,
  ): Promise<RoleEventType | null> {
    return latestRoleEventIn(this.db, sub, role, eventId);
  }

  /**
   * 047 EARS-3 — run one grant cascade for `email` alone: a transaction holding
   * `pg_advisory_xact_lock` on the email (the idiom of
   * `congress-submissions.service.ts` and the taxonomy repositories) for the
   * whole cascade, so two grants for one person cannot interleave — the second
   * reads the state the first left. The lock is held for exactly as long as
   * `run` takes — the transaction commits (or rolls back on a throw) only after
   * `run` settles, and Postgres releases an xact lock at that end, so release
   * is guaranteed on every exit, including a lost connection. The cascade's own
   * writes run on their own pooled connections; this transaction holds only the
   * lock. The lock serializes grants; the binding invariants themselves are the
   * table's unique indexes, which `commitGrant` relies on, not on the read.
   */
  async withGrantLock<T>(email: string, run: () => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`staff-access-grant:${email}`}, 0))`,
      );
      return run();
    });
  }

  /**
   * Write step (3) of the grant — ONE transaction under the request's 010 audit
   * context: the `users` mirror (inserted with the typed ФИО for an account it
   * lacks; an existing row keeps its name and only re-projects `role`), the
   * event binding when absent, and `auth.role.granted` unless it is already the
   * latest mark for (person, role, event). Every part checks its own state, so
   * the repeat of a part-failed grant finishes it and writes the mark once.
   */
  async commitGrant(commit: GrantCommit): Promise<void> {
    await withRequestAuditContext(this.db, async (tx) => {
      const [existing] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.zitadelSub, commit.sub))
        .limit(1);
      let userId: string;
      if (existing) {
        userId = existing.id;
        if (existing.role !== commit.mirrorRole) {
          await tx
            .update(users)
            .set({ role: commit.mirrorRole, updatedAt: new Date() })
            .where(eq(users.id, existing.id));
        }
      } else {
        // The mirror can also be created by a sign-in of this account outside
        // the grant lock (the 003 mirror upsert); the `zitadel_sub` unique
        // index decides, and a lost race re-projects the role on the winner.
        const [inserted] = await tx
          .insert(users)
          .values({
            zitadelSub: commit.sub,
            email: commit.email,
            emailVerified: true,
            displayName: commit.fullName,
            role: commit.mirrorRole,
          })
          .onConflictDoNothing({ target: users.zitadelSub })
          .returning({ id: users.id });
        if (inserted) {
          userId = inserted.id;
        } else {
          const [winner] = await tx
            .update(users)
            .set({ role: commit.mirrorRole, updatedAt: new Date() })
            .where(eq(users.zitadelSub, commit.sub))
            .returning({ id: users.id });
          userId = winner!.id;
        }
      }

      if (commit.eventId !== null) {
        await insertEventGrant(tx, {
          userId,
          role: commit.role as EventScopedRole,
          eventId: commit.eventId,
        });
      }

      const latest = await latestRoleEventIn(
        tx,
        commit.sub,
        commit.role,
        commit.eventId,
      );
      if (latest !== "auth.role.granted") {
        await tx.insert(auditLedger).values({
          eventId: randomUUID(),
          ...toLedgerRow(
            {
              type: "RoleGranted",
              sub: commit.sub,
              role: commit.role,
              eventId: commit.eventId,
              byAdmin: commit.byAdmin,
            },
            noIdentifier,
          ),
        });
      }
    });
  }
}

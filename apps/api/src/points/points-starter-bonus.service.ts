import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { auditLedger, type DrizzleHandle, users } from "@ds/db";
import {
  type PointsStarterBonusRun,
  RunPointsStarterBonusRequestSchema,
  type RunPointsStarterBonusRequest,
} from "@ds/schemas";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { PARTICIPANT_ROLE } from "../auth/staff-role.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  PointsEngine,
  withinWindow,
} from "./engine/points-engine.service.js";
import { PointsLedgerError } from "./points.errors.js";
import { RuleBookService } from "./rule-book.service.js";

type Db = DrizzleHandle["db"];

const FACT_TYPE = "person.starter-bonus-eligible";
/** 025-design §J — the keyset batch of the doctor walk. */
const BATCH = 500;

/** EARS-43 — the derived event id: one starter-bonus fact per doctor, ever. */
export function starterBonusFactEventId(personId: string): string {
  return `starter-bonus:${personId}`;
}

/**
 * 025 EARS-43 — the starter-bonus run (025-design §J). Records, through
 * `record`, `person.starter-bonus-eligible` for every doctor registered
 * before the instant whose points account is not closed; the seeded
 * `accrual.starter-bonus` credits it under the shared limit key `welcome`.
 * Each doctor is its own transaction, and the derived event id makes a re-run
 * (or the resume of a run cut short) answer `duplicate`. Two explicit
 * `audit_ledger` records frame the run: the opening one before the first
 * grant, the closing one with the counts.
 */
@Injectable()
export class PointsStarterBonusService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(RuleBookService) private readonly rules: RuleBookService,
    @Inject(PointsEngine) private readonly engine: PointsEngine,
  ) {}

  async run(
    input: RunPointsStarterBonusRequest,
    actorSub: string | null,
  ): Promise<PointsStarterBonusRun> {
    const body = RunPointsStarterBonusRequestSchema.parse(input);
    const registeredBefore = new Date(body.registeredBefore);
    const now = new Date();
    if (registeredBefore.getTime() > now.getTime()) {
      throw new PointsLedgerError(
        "POINTS_RULE_PARAMETERS_INVALID",
        "registeredBefore is later than now",
        [{ path: "registeredBefore", message: "not later than now" }],
      );
    }
    const candidates = await this.rules.candidatesFor(FACT_TYPE, now);
    if (!candidates.some((c) => c.rule.active && withinWindow(c.rule, now))) {
      throw new PointsLedgerError(
        "POINTS_STARTER_BONUS_NO_RULE",
        `no active rule triggers on ${FACT_TYPE}`,
      );
    }

    const runId = randomUUID();
    await this.audit("points.starter-bonus.started", actorSub, {
      runId,
      reason: body.reason,
      registeredBefore: registeredBefore.toISOString(),
    });

    const counts = { applied: 0, duplicate: 0, noEffect: 0, skipped: 0 };
    // Table-qualified by hand: inside a selection drizzle renders a column
    // unqualified, which the subquery would resolve against its own table.
    const closed = sql<boolean>`exists (
      select 1 from points_accounts pa
       where pa.subject_kind = 'person'
         and pa.subject_id = "users"."id"
         and pa.closed_at is not null
    )`;
    let after: string | null = null;
    for (;;) {
      const batch: Array<{ id: string; closed: boolean }> = await this.db
        .select({ id: users.id, closed })
        .from(users)
        .where(
          and(
            lt(users.createdAt, registeredBefore),
            eq(users.role, PARTICIPANT_ROLE),
            after === null ? undefined : gt(users.id, after),
          ),
        )
        .orderBy(asc(users.id))
        .limit(BATCH);
      for (const doctor of batch) {
        if (doctor.closed) {
          counts.skipped += 1;
          continue;
        }
        const { outcome } = await this.engine.record({
          type: FACT_TYPE,
          eventId: starterBonusFactEventId(doctor.id),
          personId: doctor.id,
          occurredAt: new Date(),
          attributes: { runId },
        });
        if (outcome === "applied") counts.applied += 1;
        else if (outcome === "duplicate") counts.duplicate += 1;
        else counts.noEffect += 1;
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1]!.id;
    }

    await this.audit("points.starter-bonus.completed", actorSub, {
      runId,
      ...counts,
    });
    return {
      runId,
      registeredBefore: registeredBefore.toISOString(),
      ...counts,
    };
  }

  /** One explicit `audit_ledger` record of the run (no PD — ids, the reason, counts). */
  private async audit(
    eventType: string,
    actorSub: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await withRequestAuditContext(this.db, async (tx) => {
      await tx.insert(auditLedger).values({
        eventId: randomUUID(),
        eventType,
        subjectId: actorSub,
        metadata,
      });
    });
  }
}

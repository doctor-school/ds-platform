import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsRuleVersionRow,
  pointsRuleVersions,
  users,
} from "@ds/db";
import {
  isPointsRuleId,
  POINTS_RULE_PARAMETER_SCHEMAS,
  type PointsRuleId,
  type PointsRuleParameters,
} from "@ds/schemas";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { PointsLedgerError } from "./points.errors.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** A rule version as the engine evaluates it — parameters parsed by the rule's own schema. */
export interface ActiveRuleVersion<R extends PointsRuleId> {
  ruleId: R;
  version: number;
  parameters: PointsRuleParameters<R>;
  effectiveFrom: Date;
}

export interface PublishRuleVersionInput {
  ruleId: string;
  parameters: unknown;
  /** Absent = now. Never earlier than now (EARS-25: no retroactive version). */
  effectiveFrom?: Date | undefined;
  /** The publishing admin's IdP subject; resolved to `users.id` for `published_by`. */
  actorSub: string | null;
}

/**
 * The 025 rule book (025-design §6, EARS-25). Every amount, cap, window and
 * weight the engine applies is read from here at evaluation time — the
 * version active at the fact's `occurredAt` — never from a literal, so a
 * re-tuned rule takes effect without a release and never rewrites a past
 * posting (each posting cites its `rule_id` + `rule_version`, EARS-27).
 */
@Injectable()
export class RuleBookService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * The highest version of `ruleId` with `effective_from ≤ at`. Version 1 of
   * every rule is seeded at the epoch (0059), so a missing version is a broken
   * deployment, not a caller error.
   */
  async activeVersion<R extends PointsRuleId>(
    ruleId: R,
    at: Date,
    executor: Executor = this.db,
  ): Promise<ActiveRuleVersion<R>> {
    const [row] = await executor
      .select()
      .from(pointsRuleVersions)
      .where(
        and(
          eq(pointsRuleVersions.ruleId, ruleId),
          lte(pointsRuleVersions.effectiveFrom, at),
        ),
      )
      .orderBy(desc(pointsRuleVersions.version))
      .limit(1);
    if (!row) {
      throw new Error(
        `points: no version of rule ${ruleId} is active at ${at.toISOString()} (0059 seeds v1 of every rule)`,
      );
    }
    return {
      ruleId,
      version: row.version,
      parameters: POINTS_RULE_PARAMETER_SCHEMAS[ruleId].parse(
        row.parameters,
      ) as PointsRuleParameters<R>,
      effectiveFrom: row.effectiveFrom,
    };
  }

  /**
   * EARS-25 — validate the parameters against the rule's schema, then store
   * them as the next immutable version, in one audit-attributed transaction
   * (the 0058 row-audit trigger records the actor of the request context).
   * Concurrent publishes of one rule serialise on a transaction-scoped
   * advisory lock, so version numbers are gap-free and never collide.
   */
  async publish(input: PublishRuleVersionInput): Promise<PointsRuleVersionRow> {
    if (!isPointsRuleId(input.ruleId)) {
      throw new PointsLedgerError("POINTS_RULE_UNKNOWN");
    }
    const ruleId = input.ruleId;
    const parsed = POINTS_RULE_PARAMETER_SCHEMAS[ruleId].safeParse(
      input.parameters,
    );
    if (!parsed.success) {
      throw new PointsLedgerError(
        "POINTS_RULE_PARAMETERS_INVALID",
        undefined,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    const now = new Date();
    const effectiveFrom = input.effectiveFrom ?? now;
    if (effectiveFrom.getTime() < now.getTime()) {
      throw new PointsLedgerError("POINTS_RULE_EFFECTIVE_FROM_PAST");
    }
    return withRequestAuditContext(this.db, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`points-rule:${ruleId}`}, 0))`,
      );
      const [latest] = await tx
        .select({ version: pointsRuleVersions.version })
        .from(pointsRuleVersions)
        .where(eq(pointsRuleVersions.ruleId, ruleId))
        .orderBy(desc(pointsRuleVersions.version))
        .limit(1);
      const publishedBy = input.actorSub
        ? ((
            await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.zitadelSub, input.actorSub))
          )[0]?.id ?? null)
        : null;
      const [row] = await tx
        .insert(pointsRuleVersions)
        .values({
          ruleId,
          version: (latest?.version ?? 0) + 1,
          parameters: parsed.data,
          effectiveFrom,
          publishedBy,
        })
        .returning();
      return row!;
    });
  }
}

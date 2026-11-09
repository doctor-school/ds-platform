import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  type PointsRuleVersionRow,
  pointsRuleVersions,
  users,
} from "@ds/db";
import {
  isPointsSettingId,
  parsePointsRuleBody,
  POINTS_RETIRED_RULE_IDS,
  pointsRuleTriggerFactTypes,
  PointsRuleSchema,
  type PointsRule,
  type PointsRuleBody,
  type PointsSettingId,
} from "@ds/schemas";
import { and, asc, desc, eq, inArray, isNotNull, like, lte, sql } from "drizzle-orm";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { checkRuleBody, type PublishIssue } from "./engine/publish-check.js";
import { PointsLedgerError } from "./points.errors.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** A rule version the engine evaluates (kind `rule`). */
export interface CandidateRule {
  ruleId: string;
  version: number;
  rule: PointsRule;
}

export interface PublishRuleVersionInput {
  ruleId: string;
  parameters: unknown;
  /** Absent = now. Never earlier than now (amended EARS-25 / EARS-42). */
  effectiveFrom?: Date | undefined;
  /** The publishing admin's IdP subject; resolved to `users.id` for `published_by`. */
  actorSub: string | null;
}

/** EARS-38 — an accepted publish that stacks with another active credit rule. */
export interface StackingWarning {
  code: "stacking";
  factType: string;
  otherRuleId: string;
}

export interface PublishedRuleVersion {
  row: PointsRuleVersionRow;
  warnings: StackingWarning[];
}

const RETIRED = new Set<string>(POINTS_RETIRED_RULE_IDS);

/** The highest version per rule id among rows ordered (rule id, version desc). */
function latestPerRule<T extends { ruleId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.ruleId)) return false;
    seen.add(row.ruleId);
    return true;
  });
}

/**
 * The 025 rule book (025-design production amendment B, D; amended EARS-25,
 * EARS-37…39, EARS-42). Rules and settings are rows of the immutable
 * `points_rule_versions`; the version of a rule id that applies to a fact is
 * the highest one with `effective_from ≤ occurredAt`, so a re-tuned rule takes
 * effect without a release and never rewrites a past posting (each posting
 * cites its `rule_id` + `rule_version`, EARS-27). There is no cache: the
 * candidate query is index-backed (GIN on `trigger_fact_types`) per fact.
 */
@Injectable()
export class RuleBookService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Amended EARS-3 — every rule whose version active at `at` triggers on
   * `factType`. The version is chosen first and its trigger tested after, so
   * a later version that dropped the trigger (or a 0059 v1 row with its empty
   * trigger) is never matched through an earlier one. Ordered by rule id.
   */
  async candidatesFor(
    factType: string,
    at: Date,
    executor: Executor = this.db,
  ): Promise<CandidateRule[]> {
    const triggering = executor
      .selectDistinct({ ruleId: pointsRuleVersions.ruleId })
      .from(pointsRuleVersions)
      .where(
        sql`${pointsRuleVersions.triggerFactTypes} @> ARRAY[${factType}]::text[]`,
      );
    const rows = await executor
      .select()
      .from(pointsRuleVersions)
      .where(
        and(
          inArray(pointsRuleVersions.ruleId, triggering),
          lte(pointsRuleVersions.effectiveFrom, at),
        ),
      )
      .orderBy(asc(pointsRuleVersions.ruleId), desc(pointsRuleVersions.version));
    return latestPerRule(rows)
      .filter(
        (row) =>
          row.kind === "rule" && row.triggerFactTypes.includes(factType),
      )
      .map((row) => ({
        ruleId: row.ruleId,
        version: row.version,
        // Stored bodies passed the schema at publish (or are the 0060 seed).
        rule: PointsRuleSchema.parse(row.parameters),
      }));
  }

  /** EARS-39 — the value of every setting active at `at`. */
  async settingsAt(
    at: Date,
    executor: Executor = this.db,
  ): Promise<Record<PointsSettingId, number>> {
    const rows = await executor
      .select({
        ruleId: pointsRuleVersions.ruleId,
        parameters: pointsRuleVersions.parameters,
      })
      .from(pointsRuleVersions)
      .where(
        and(
          like(pointsRuleVersions.ruleId, "setting.%"),
          lte(pointsRuleVersions.effectiveFrom, at),
        ),
      )
      .orderBy(asc(pointsRuleVersions.ruleId), desc(pointsRuleVersions.version));
    const settings: Partial<Record<PointsSettingId, number>> = {};
    for (const row of latestPerRule(rows)) {
      if (!isPointsSettingId(row.ruleId)) continue;
      settings[row.ruleId] = (row.parameters as { value: number }).value;
    }
    return settings as Record<PointsSettingId, number>;
  }

  /**
   * Amended EARS-25 — validate the body against the one rule schema and the
   * catalog, then store it as the next immutable version of `ruleId` (a new
   * admin slug or an existing id) in one audit-attributed transaction; the
   * 0058 row-audit trigger records the actor of the request context.
   * Concurrent publishes of one id serialise on a transaction-scoped advisory
   * lock, so version numbers are gap-free. A published version applies only to
   * facts whose `occurredAt` is at or after its `effectiveFrom` (≥ now): no
   * journaled fact is ever re-evaluated (EARS-42).
   */
  async publish(input: PublishRuleVersionInput): Promise<PublishedRuleVersion> {
    const ruleId = input.ruleId;
    if (RETIRED.has(ruleId)) {
      throw new PointsLedgerError("POINTS_RULE_RETIRED");
    }
    const parsed = parsePointsRuleBody(ruleId, input.parameters);
    if (!parsed.success) {
      throw invalid(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    const body: PointsRuleBody = parsed.data;
    const now = new Date();
    const effectiveFrom = input.effectiveFrom ?? now;
    if (effectiveFrom.getTime() < now.getTime()) {
      throw new PointsLedgerError("POINTS_RULE_EFFECTIVE_FROM_PAST");
    }
    if (body.kind === "rule") {
      const settings = await this.settingsAt(now);
      const issues = checkRuleBody(body, {
        maxAmount: settings["setting.effect.maxAmount"],
      });
      if (issues.length > 0) throw invalid(issues);
    }
    return withRequestAuditContext(this.db, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`points-rule:${ruleId}`}, 0))`,
      );
      const kinds = await tx
        .selectDistinct({ kind: pointsRuleVersions.kind })
        .from(pointsRuleVersions)
        .where(
          and(
            eq(pointsRuleVersions.ruleId, ruleId),
            isNotNull(pointsRuleVersions.kind),
          ),
        );
      const other = kinds.find((k) => k.kind !== body.kind);
      if (other) {
        throw invalid([
          {
            path: "kind",
            message: `${ruleId} is a ${other.kind}; a version keeps its kind`,
          },
        ]);
      }
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
      const warnings =
        body.kind === "rule"
          ? await this.stackingWarnings(ruleId, body, effectiveFrom, tx)
          : [];
      const [row] = await tx
        .insert(pointsRuleVersions)
        .values({
          ruleId,
          version: (latest?.version ?? 0) + 1,
          kind: body.kind,
          triggerFactTypes: pointsRuleTriggerFactTypes(body),
          parameters: body,
          effectiveFrom,
          publishedBy,
        })
        .returning();
      return { row: row!, warnings };
    });
  }

  /**
   * EARS-38 — an active credit rule sharing a trigger type with another active
   * credit rule outside a common exclusive group stacks: accepted, warned.
   */
  private async stackingWarnings(
    ruleId: string,
    rule: PointsRule,
    at: Date,
    tx: Tx,
  ): Promise<StackingWarning[]> {
    if (!rule.active || rule.effect.kind !== "credit") return [];
    const warnings: StackingWarning[] = [];
    for (const factType of rule.trigger) {
      for (const other of await this.candidatesFor(factType, at, tx)) {
        if (other.ruleId === ruleId) continue;
        if (!other.rule.active || other.rule.effect.kind !== "credit") continue;
        const group = rule.stacking.exclusiveGroup;
        if (group !== null && group === other.rule.stacking.exclusiveGroup) {
          continue;
        }
        warnings.push({ code: "stacking", factType, otherRuleId: other.ruleId });
      }
    }
    return warnings;
  }
}

function invalid(issues: readonly PublishIssue[]): PointsLedgerError {
  return new PointsLedgerError(
    "POINTS_RULE_PARAMETERS_INVALID",
    undefined,
    issues,
  );
}

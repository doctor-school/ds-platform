import type { DrizzleHandle } from "@ds/db";
import { pointsFacts } from "@ds/db";
import type { PointsParsedRecordFact } from "@ds/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ConditionValue, PointsPredicateResolver } from "./condition.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/**
 * 025 EARS-34 — the registered predicates (`POINTS_PREDICATES`), evaluated for
 * ONE fact inside its evaluation transaction, memoised per evaluation.
 *
 * Timing: a journal predicate sees the state INCLUDING the fact under
 * evaluation — the fact counts as if already journaled (its row is inserted
 * at the end of `record`), so an invitee's first `lesson.completed` counts
 * itself in `person.completedLessons` (EARS-11). Every condition is evaluated
 * before any effect is applied, so nothing a rule of this fact writes is
 * visible to a predicate of the same fact.
 *
 * The `item.*` predicates read the price list, which ships with the spend
 * slice (#3810, 025-design H); until it exists no item has a price row, so
 * they answer the declared no-row values (`null`, `null`, `false`).
 */
export class JournalPredicateResolver implements PointsPredicateResolver {
  private readonly memo = new Map<string, Promise<ConditionValue>>();

  constructor(
    private readonly executor: Executor,
    private readonly fact: PointsParsedRecordFact,
  ) {}

  resolve(
    name: string,
    args: Readonly<Record<string, ConditionValue>>,
  ): Promise<ConditionValue> {
    const key = `${name}(${JSON.stringify(args)})`;
    let value = this.memo.get(key);
    if (!value) {
      value = this.compute(name);
      this.memo.set(key, value);
    }
    return value;
  }

  private async compute(name: string): Promise<ConditionValue> {
    switch (name) {
      case "person.registered":
        return this.hasFact("account.registered");
      case "person.phoneVerified":
        return this.hasFact("phone.verified");
      case "person.completedLessons":
        return this.completedLessons();
      case "person.referrer":
        return this.referrer();
      case "item.price":
      case "item.mode":
        return null;
      case "item.limitedSeats":
        return false;
      default:
        throw new Error(`points: unregistered predicate ${name}`);
    }
  }

  private async hasFact(type: string): Promise<boolean> {
    if (this.fact.type === type) return true;
    const [row] = await this.executor
      .select({ one: sql<number>`1` })
      .from(pointsFacts)
      .where(
        and(
          eq(pointsFacts.personId, this.fact.personId),
          eq(pointsFacts.type, type),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async completedLessons(): Promise<number> {
    const rows = await this.executor
      .selectDistinct({ refId: pointsFacts.refId })
      .from(pointsFacts)
      .where(
        and(
          eq(pointsFacts.personId, this.fact.personId),
          eq(pointsFacts.type, "lesson.completed"),
        ),
      );
    const refs = new Set(rows.map((r) => r.refId));
    if (this.fact.type === "lesson.completed" && this.fact.ref) {
      refs.add(this.fact.ref);
    }
    return refs.size;
  }

  private async referrer(): Promise<string | null> {
    if (this.fact.type === "referral.attributed" && this.fact.ref) {
      return this.fact.ref;
    }
    const [row] = await this.executor
      .select({ refId: pointsFacts.refId })
      .from(pointsFacts)
      .where(
        and(
          eq(pointsFacts.personId, this.fact.personId),
          eq(pointsFacts.type, "referral.attributed"),
        ),
      )
      .orderBy(desc(pointsFacts.receivedAt))
      .limit(1);
    return row?.refId ?? null;
  }
}

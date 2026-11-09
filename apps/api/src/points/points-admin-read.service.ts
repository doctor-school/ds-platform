import { Inject, Injectable } from "@nestjs/common";
import { type DrizzleHandle, pointsFacts, pointsRuleVersions } from "@ds/db";
import {
  POINTS_FACT_TYPES,
  POINTS_PREDICATES,
  type PointsFactJournalPage,
  PointsFactJournalPageSchema,
  type PointsFactTypeCatalog,
  type PointsRuleBook,
  type PointsRuleBookEntry,
} from "@ds/schemas";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  encodeFactJournalCursor,
  type FactJournalPosition,
} from "./points-history-cursor.js";

type Db = DrizzleHandle["db"];
type RuleKind = PointsRuleBookEntry["kind"];

/**
 * 025 EARS-45 — the admin read side of the engine (025-design §8): the
 * fact-type catalog as the code registers it, the rule book with every
 * version, and one person's fact journal. Read-only; no row is written.
 */
@Injectable()
export class PointsAdminReadService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** The code catalog (EARS-32, EARS-34) — declarations only, no data. */
  factTypeCatalog(): PointsFactTypeCatalog {
    return {
      factTypes: Object.values(POINTS_FACT_TYPES).map((entry) => ({
        ...entry,
        attributes: { ...entry.attributes },
      })) as PointsFactTypeCatalog["factTypes"],
      predicates: Object.values(
        POINTS_PREDICATES,
      ) as PointsFactTypeCatalog["predicates"],
    };
  }

  /**
   * Every rule and setting id with its history in version order and the
   * version active at `at` — the highest with `effective_from ≤ at`, the
   * rule book's own `activeVersion` rule (025-design §6). Ordered by rule id
   * (code-point order).
   */
  async ruleBook(at: Date = new Date()): Promise<PointsRuleBook> {
    const rows = await this.db
      .select()
      .from(pointsRuleVersions)
      .orderBy(asc(pointsRuleVersions.ruleId), asc(pointsRuleVersions.version));
    const byId = new Map<string, PointsRuleBookEntry>();
    for (const row of rows) {
      let entry = byId.get(row.ruleId);
      if (!entry) {
        entry = {
          ruleId: row.ruleId,
          kind: null,
          activeVersion: null,
          versions: [],
        };
        byId.set(row.ruleId, entry);
      }
      const kind = (row.kind ?? null) as RuleKind;
      // A version keeps its kind; only 0059 v1 rows predate kinds.
      if (kind !== null) entry.kind = kind;
      if (row.effectiveFrom.getTime() <= at.getTime()) {
        entry.activeVersion = row.version;
      }
      entry.versions.push({
        version: row.version,
        kind,
        triggerFactTypes: row.triggerFactTypes,
        parameters: row.parameters as Record<string, unknown>,
        effectiveFrom: row.effectiveFrom.toISOString(),
        publishedBy: row.publishedBy,
        createdAt: row.createdAt.toISOString(),
      });
    }
    // Code-point order: rule ids are ASCII-only slugs, so this JS sort and
    // Postgres `ORDER BY rule_id COLLATE "C"` agree.
    const rules = [...byId.values()].sort((a, b) =>
      a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0,
    );
    return { rules };
  }

  /**
   * One person's journal (EARS-40), newest first by (`received_at`,
   * `event_id`) — the `points_facts_person_received_idx` order — one keyset
   * page. Traces are returned as stored; the row's attributes are not part of
   * the read model.
   */
  async factJournal(
    personId: string,
    page: { limit: number; after: FactJournalPosition | null },
  ): Promise<PointsFactJournalPage> {
    const rows = await this.db
      .select({
        eventId: pointsFacts.eventId,
        type: pointsFacts.type,
        refId: pointsFacts.refId,
        occurredAt: pointsFacts.occurredAt,
        receivedAt: pointsFacts.receivedAt,
        receivedAtKey: sql<string>`to_char(${pointsFacts.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        outcome: pointsFacts.outcome,
        trace: pointsFacts.trace,
      })
      .from(pointsFacts)
      .where(
        and(
          eq(pointsFacts.personId, personId),
          page.after
            ? sql`(${pointsFacts.receivedAt}, ${pointsFacts.eventId}) < (${page.after.receivedAt}::timestamptz, ${page.after.eventId}::text)`
            : undefined,
        ),
      )
      .orderBy(desc(pointsFacts.receivedAt), desc(pointsFacts.eventId))
      .limit(page.limit + 1);
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return PointsFactJournalPageSchema.parse({
      items: items.map((row) => ({
        eventId: row.eventId,
        type: row.type,
        ...(row.refId === null ? {} : { ref: row.refId }),
        occurredAt: row.occurredAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        outcome: row.outcome,
        trace: row.trace,
      })),
      nextCursor:
        rows.length > page.limit && last
          ? encodeFactJournalCursor({
              receivedAt: last.receivedAtKey,
              eventId: last.eventId,
            })
          : null,
    });
  }
}

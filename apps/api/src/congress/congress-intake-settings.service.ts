import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import {
  congressSubmissionKindSettings,
  congressSubmissionSettings,
  events,
} from "@ds/db";
import {
  CONGRESS_INTAKE_DEFAULTS,
  CONGRESS_SUBMISSION_KINDS,
  type CongressIntakeSettings,
  type CongressIntakeSettingsRequest,
  type CongressKindSettings,
  type CongressKindSettingsInput,
  type CongressSubmissionKind,
  instantToMskDay,
  lastDayOfClosingInstant,
  mskClosingInstantAfterLastDay,
  mskDayStartInstant,
} from "@ds/schemas";
import { and, eq, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

type Db = DrizzleHandle["db"];

/** Canonical UUID shape — a non-uuid `:id` names no event (404, not a driver error). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type KindRow = typeof congressSubmissionKindSettings.$inferSelect;

/**
 * 046 EARS-1…EARS-3 (#2432) — the congress intake settings of one event, read
 * and written by the platform administrator.
 *
 * The body carries Moscow calendar days; this service stores instants through
 * the one conversion in `@ds/schemas` (EARS-3) and projects them back to days
 * on the read. Settings are platform data read per request, so a saved change
 * is effective on the next request without a release (EARS-2).
 *
 * Writes run in the request audit context: the 010 triggers on both tables
 * append the `data.*` ledger rows attributed to the acting administrator. An
 * unchanged row is not rewritten (`setWhere … IS DISTINCT FROM`), so the ledger
 * records changes, not saves.
 */
@Injectable()
export class CongressIntakeSettingsService {
  // Explicit @Inject tokens — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** The event's settings, or the product defaults while it has none (EARS-2). */
  async read(eventId: string): Promise<CongressIntakeSettings> {
    await this.assertEvent(this.db, eventId);
    return this.project(this.db, eventId);
  }

  /** Save the whole settings of one event (create-or-replace) and read them back. */
  async save(
    eventId: string,
    body: CongressIntakeSettingsRequest,
  ): Promise<CongressIntakeSettings> {
    return withRequestAuditContext(this.db, async (tx) => {
      await this.assertEvent(tx, eventId);
      const s = congressSubmissionSettings;
      await tx
        .insert(s)
        .values({
          eventId,
          registrationUrl: body.registrationUrl,
          firstAuthorCounts: body.firstAuthorCounts,
        })
        .onConflictDoUpdate({
          target: s.eventId,
          set: {
            registrationUrl: sql`excluded.registration_url`,
            firstAuthorCounts: sql`excluded.first_author_counts`,
          },
          setWhere: sql`(${s.registrationUrl}, ${s.firstAuthorCounts})
            IS DISTINCT FROM (excluded.registration_url, excluded.first_author_counts)`,
        });

      const k = congressSubmissionKindSettings;
      await tx
        .insert(k)
        .values(
          CONGRESS_SUBMISSION_KINDS.map((kind) =>
            kindRow(eventId, kind, body.kinds[kind]),
          ),
        )
        .onConflictDoUpdate({
          target: [k.eventId, k.kind],
          set: {
            opensAt: sql`excluded.opens_at`,
            closesAt: sql`excluded.closes_at`,
            submitLimit: sql`excluded.submit_limit`,
            maxAgeYears: sql`excluded.max_age_years`,
          },
          setWhere: sql`(${k.opensAt}, ${k.closesAt}, ${k.submitLimit}, ${k.maxAgeYears})
            IS DISTINCT FROM (excluded.opens_at, excluded.closes_at, excluded.submit_limit, excluded.max_age_years)`,
        });

      return this.project(tx, eventId);
    });
  }

  private async assertEvent(db: Pick<Db, "select">, eventId: string) {
    if (!UUID_RE.test(eventId)) throw new NotFoundException("event not found");
    const [found] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.recordStatus, "active")))
      .limit(1);
    if (!found) throw new NotFoundException("event not found");
  }

  private async project(
    db: Pick<Db, "select">,
    eventId: string,
  ): Promise<CongressIntakeSettings> {
    const [settings] = await db
      .select()
      .from(congressSubmissionSettings)
      .where(eq(congressSubmissionSettings.eventId, eventId))
      .limit(1);
    if (!settings) return defaultsFor(eventId);

    const rows = await db
      .select()
      .from(congressSubmissionKindSettings)
      .where(eq(congressSubmissionKindSettings.eventId, eventId));
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    const kind = (k: CongressSubmissionKind): CongressKindSettings => {
      const row = byKind.get(k);
      return row
        ? projectKind(row)
        : fromInput(k, CONGRESS_INTAKE_DEFAULTS.kinds[k]);
    };
    return {
      eventId,
      configured: true,
      registrationUrl: settings.registrationUrl,
      firstAuthorCounts: settings.firstAuthorCounts,
      kinds: {
        oral: kind("oral"),
        poster: kind("poster"),
        abstract: kind("abstract"),
      },
    };
  }
}

function kindRow(
  eventId: string,
  kind: CongressSubmissionKind,
  input: CongressKindSettingsInput,
): KindRow {
  return {
    eventId,
    kind,
    opensAt: input.opensOn === null ? null : mskDayStartInstant(input.opensOn),
    closesAt:
      input.lastDay === null
        ? null
        : mskClosingInstantAfterLastDay(input.lastDay),
    submitLimit: input.submitLimit,
    maxAgeYears: input.maxAgeYears,
  };
}

function projectKind(row: KindRow): CongressKindSettings {
  return {
    kind: row.kind,
    opensOn: row.opensAt ? instantToMskDay(row.opensAt) : null,
    lastDay: row.closesAt ? lastDayOfClosingInstant(row.closesAt) : null,
    opensAt: row.opensAt ? row.opensAt.toISOString() : null,
    closesAt: row.closesAt ? row.closesAt.toISOString() : null,
    submitLimit: row.submitLimit,
    maxAgeYears: row.maxAgeYears,
  };
}

function fromInput(
  kind: CongressSubmissionKind,
  input: CongressKindSettingsInput,
): CongressKindSettings {
  return projectKind(kindRow("", kind, input));
}

/** An event with no settings row: not configured, prefilled with the defaults (EARS-1, EARS-2). */
function defaultsFor(eventId: string): CongressIntakeSettings {
  const d = CONGRESS_INTAKE_DEFAULTS;
  return {
    eventId,
    configured: false,
    registrationUrl: d.registrationUrl,
    firstAuthorCounts: d.firstAuthorCounts,
    kinds: {
      oral: fromInput("oral", d.kinds.oral),
      poster: fromInput("poster", d.kinds.poster),
      abstract: fromInput("abstract", d.kinds.abstract),
    },
  };
}

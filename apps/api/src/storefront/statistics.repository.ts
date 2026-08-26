import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { events, users } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 017 EARS-2 / LD-3 (#1480) — the data sources behind the scale counters.
//
// READ-ONLY by construction, like the specialty repository: statistics are
// derived, so there is no insert/update path for a counter to be typed into.
//
// These queries run on the REFRESH path (a bounded-staleness projection), never
// per request — LD-3 forbids counting rows on the read path. That is what makes
// an aggregate over the whole `users` / `events` table an acceptable shape here:
// it executes once per staleness window, not once per home-page view.

type Db = DrizzleHandle["db"];

/**
 * How far back «events per year» looks. A ROLLING twelve months rather than a
 * calendar year: the hero figure must not collapse to a near-zero every January
 * and then climb back — a doctor reads it as "how much happens here", and a
 * calendar reset would misstate exactly that.
 */
const EVENTS_WINDOW = sql`now() - interval '1 year'`;

/**
 * The roles the public «врачей уже с нами» figure counts — ENUMERATED, never a
 * prefix match over the free-text `users.role` column.
 *
 * A `like 'doctor%'` predicate would silently enrol any future role whose name
 * merely starts with «doctor» into a public headline figure, and would silently
 * drop the count on a rename; neither failure shows up anywhere but on the home
 * page. Listing the roles makes both changes a deliberate edit here.
 *
 * `doctor_guest` is the v1 self-service role granted on self-registration
 * (glossary `doctor_guest`), so the figure means REGISTERED DOCTOR ACCOUNTS —
 * a product statement, stated here and in the module README rather than left
 * implicit in a predicate. `platform_admin` / `pd_officer` are staff and are
 * not counted.
 */
export const DOCTOR_ROLES = ["doctor_guest"] as const;

@Injectable()
export class StatisticsRepository {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Doctors on the platform: present (`record_status = 'active'`), not
   * deactivated in the identity SoT mirror, and holding a doctor role.
   *
   * Retired and IdP-deactivated rows are excluded on purpose — they are
   * retained for the audit trail (ADR-0003 design §3.6), and counting them
   * would make the hero figure a count of database rows rather than of doctors
   * who can actually open the platform.
   */
  async countDoctors(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.recordStatus, "active"),
          isNull(users.deactivatedAt),
          inArray(users.role, [...DOCTOR_ROLES]),
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * Events over the trailing year: present rows that have left `draft` and
   * whose scheduled instant falls inside the window up to now.
   *
   * A draft is not an event that happened; a future date has not happened yet.
   * Both would inflate a figure a doctor reads as track record.
   */
  async countEventsPerYear(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(events)
      .where(
        and(
          eq(events.recordStatus, "active"),
          ne(events.state, "draft"),
          gte(events.startsAt, EVENTS_WINDOW),
          lte(events.startsAt, sql`now()`),
        ),
      );
    return row?.value ?? 0;
  }
}

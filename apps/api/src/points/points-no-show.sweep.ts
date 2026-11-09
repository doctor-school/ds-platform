import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { DrizzleHandle } from "@ds/db";
import { sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { PointsEngine } from "./engine/points-engine.service.js";
import { RuleBookService } from "./rule-book.service.js";

type Db = DrizzleHandle["db"];

/** The fact event id of a registration's no-show (025 EARS-18) — a re-run answers `duplicate`. */
export function noShowFactEventId(registrationId: string): string {
  return `no-show:${registrationId}`;
}

/**
 * 025 EARS-18 — the no-show sweep (025-design E). Every quarter hour it
 * records `registration.no-show` for each registration whose hold is still
 * `held` once its item ended more than `setting.noShow.window` hours ago,
 * and the seeded `spend.release` releases the hold. The fact event id
 * `no-show:<registrationId>` makes a re-run (or a second API instance)
 * answer `duplicate`. It reports facts only (EARS-33).
 *
 * An item's end is known for events only: an event that reached `ended` (or
 * moved on to `in_archive`) at its scheduled end `starts_at + duration_min`.
 * The room records `attendance.confirmed` inside the transaction that ends the
 * event (EARS-9), so a registration still held after the window had no
 * attendance at or above the presence share. Other item kinds carry no end
 * yet; their holds are released by their own cancel or void facts.
 */
@Injectable()
export class PointsNoShowSweep implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL_NAME = "points-no-show-sweep";
  static readonly INTERVAL_MS = 15 * 60 * 1000;
  static readonly BATCH = 500;

  private readonly logger = new Logger(PointsNoShowSweep.name);
  private running = false;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(PointsEngine) private readonly engine: PointsEngine,
    @Inject(RuleBookService) private readonly rules: RuleBookService,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    this.clear();
    const handle = setInterval(() => {
      void this.runOnce();
    }, PointsNoShowSweep.INTERVAL_MS);
    handle.unref();
    this.registry.addInterval(PointsNoShowSweep.INTERVAL_NAME, handle);
  }

  onModuleDestroy(): void {
    this.clear();
  }

  /** One sweep; returns how many no-show facts it recorded as new. */
  async runOnce(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const windowHours = (await this.rules.settingsAt(now))[
        "setting.noShow.window"
      ];
      const { rows } = await this.db.execute<{
        registration_id: string;
        item_ref: string;
        person_id: string;
      }>(sql`
        SELECT r.registration_id, r.item_ref, a.subject_id AS person_id
          FROM points_reserves r
          JOIN points_accounts a ON a.id = r.person_account_id
          JOIN events e ON e.id::text = r.item_ref
         WHERE r.state = 'held'
           AND e.state IN ('ended', 'in_archive')
           AND e.starts_at + make_interval(mins => e.duration_min)
               + make_interval(hours => ${windowHours}::int) <= ${now.toISOString()}::timestamptz
         ORDER BY r.held_at, r.registration_id
         LIMIT ${PointsNoShowSweep.BATCH}`);
      let recorded = 0;
      for (const row of rows) {
        try {
          const result = await this.engine.record({
            type: "registration.no-show",
            eventId: noShowFactEventId(row.registration_id),
            personId: row.person_id,
            ref: row.item_ref,
            occurredAt: now,
            attributes: { registrationId: row.registration_id },
          });
          if (result.outcome !== "duplicate") recorded += 1;
        } catch (e) {
          this.logger.error(
            `no-show of registration ${row.registration_id} failed: ${(e as Error).message}`,
          );
        }
      }
      return recorded;
    } catch (e) {
      this.logger.error(`points no-show sweep failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private clear(): void {
    if (this.registry.getIntervals().includes(PointsNoShowSweep.INTERVAL_NAME)) {
      this.registry.deleteInterval(PointsNoShowSweep.INTERVAL_NAME);
    }
  }
}

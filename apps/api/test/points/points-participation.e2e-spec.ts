import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { DrizzleHandle } from "@ds/db";
import type { PointsCreditedEvent } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import {
  DRIZZLE_DB,
  DRIZZLE_POOL,
} from "../../src/database/database.tokens.js";
import { EventsService } from "../../src/events/events.service.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { PointsEventsPublisher } from "../../src/points/points-events.js";
import {
  AttendanceFactsProducer,
  attendanceFactEventId,
} from "../../src/room/attendance-facts.producer.js";
import { ROOM_HEARTBEAT_INTERVAL_SECONDS } from "../../src/room/room.tokens.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 025 EARS-9 (#3845) — the room reports attendance when the event ends. The
// real 007 `CloseRoom` (`live → ended`) runs the producer: one
// `attendance.confirmed` per doctor with presence, the share computed
// server-side from the durable 006 beats over the scheduled duration, and the
// seeded `accrual.participation` (+2 Bre +1 Con, `oncePer(subject, ref)`,
// condition `presenceSharePercent ≥ setting.presence.share` [30 %]) decides who
// is credited. Runs against a Postgres migrated through 0060 and the fake IdP;
// skips when DATABASE_URL or IDP_ISSUER is absent. Postings and journal rows
// are append-only and keyed to persons unique per run, so they are not tidied.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 EARS-9 participation award at the event's end (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let events: EventsService;
    let producer: AttendanceFactsProducer;
    let intervalSeconds: number;
    const credited: PointsCreditedEvent[] = [];
    const createdSubs: string[] = [];
    const createdEventIds: string[] = [];

    /** A `live` platform event of `durationMin` scheduled minutes. */
    async function seedLiveEvent(durationMin: number): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live', ${eventClassificationSql()})`,
        [
          id,
          `pts-part-${id.slice(0, 8)}`,
          "Участие в эфире",
          "Кардиология сегодня",
          new Date(Date.now() - 2 * 3600_000).toISOString(),
          durationMin,
          "",
          ["cardiology"],
          null,
          null,
        ],
      );
      createdEventIds.push(id);
      return id;
    }

    /** A registered doctor who beat `beats` distinct N-second buckets on the event. */
    async function attendingDoctor(
      eventId: string,
      beats: number,
    ): Promise<{ userId: string; registrationId: string }> {
      const sub = `pts-part-${randomUUID()}`;
      createdSubs.push(sub);
      const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (zitadel_sub, email, role) VALUES ($1, $2, 'doctor_guest') RETURNING id",
        [sub, `${sub}@ds.test`],
      );
      const userId = rows[0]!.id;
      const reg = await pool.query<{ id: string }>(
        "INSERT INTO registrations (user_id, event_id) VALUES ($1, $2) RETURNING id",
        [userId, eventId],
      );
      const start = Math.floor(Date.now() / 1000 / intervalSeconds) - beats - 1;
      for (let i = 0; i < beats; i++) {
        await pool.query(
          "INSERT INTO presence_beats (user_id, event_id, beat_at) VALUES ($1, $2, to_timestamp($3))",
          [userId, eventId, (start + i) * intervalSeconds],
        );
      }
      return { userId, registrationId: reg.rows[0]!.id };
    }

    /** Beats worth `percent` % of a `durationMin` event at cadence N. */
    function beatsFor(percent: number, durationMin: number): number {
      return Math.ceil(((percent / 100) * durationMin * 60) / intervalSeconds);
    }

    async function balanceOf(userId: string): Promise<Record<string, number>> {
      const { rows } = await pool.query<{ denomination: string; sum: string }>(
        `SELECT p.denomination, sum(p.amount)::text AS sum
           FROM points_postings p
           JOIN points_accounts c ON c.id = p.credit_account_id
          WHERE c.subject_id = $1
          GROUP BY p.denomination`,
        [userId],
      );
      return Object.fromEntries(
        rows.map((r) => [r.denomination, Number(r.sum)]),
      );
    }

    async function journalOf(eventId: string, userId: string) {
      const { rows } = await pool.query<{
        outcome: string;
        ref: string;
        attributes: Record<string, unknown>;
      }>(
        "SELECT outcome, ref_id AS ref, attributes FROM points_facts WHERE event_id = $1",
        [attendanceFactEventId(eventId, userId)],
      );
      return rows;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.init();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      events = app.get(EventsService);
      producer = app.get(AttendanceFactsProducer);
      intervalSeconds = app.get<number>(ROOM_HEARTBEAT_INTERVAL_SECONDS);
      app.get(PointsEventsPublisher).onCredited((event) => {
        credited.push(event);
      });
    });

    afterEach(async () => {
      credited.splice(0);
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM presence_beats WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const sub of createdSubs.splice(0))
        await deleteUserFixture(pool, "zitadel_sub", sub);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-9: CloseRoom credits +2 Bre +1 Con to the doctor at ≥ 30 % presence, nothing to the one below, no Pul to anyone", async () => {
      const eventId = await seedLiveEvent(100);
      const present = await attendingDoctor(eventId, beatsFor(40, 100));
      const brief = await attendingDoctor(eventId, beatsFor(10, 100));

      await events.closeRoom(eventId, null);

      expect(await balanceOf(present.userId)).toEqual({ bre: 2, con: 1 });
      expect(await balanceOf(brief.userId)).toEqual({});

      // Both facts are recorded — the producer does not filter; the rule's
      // condition is what refuses the short presence.
      const [presentFact] = await journalOf(eventId, present.userId);
      expect(presentFact).toMatchObject({ outcome: "applied", ref: eventId });
      expect(presentFact!.attributes).toEqual({
        presenceSharePercent: 40,
        registrationId: present.registrationId,
      });
      const [briefFact] = await journalOf(eventId, brief.userId);
      expect(briefFact!.attributes).toMatchObject({ presenceSharePercent: 10 });
      expect(briefFact!.outcome).not.toBe("applied");

      // One PointsCredited, after the end committed, for the credited doctor.
      expect(credited.map((c) => c.personId)).toEqual([present.userId]);
      expect(credited[0]!.postings).toEqual(
        expect.arrayContaining([
          { denomination: "bre", amount: 2 },
          { denomination: "con", amount: 1 },
        ]),
      );
    });

    it("EARS-9: a re-run of the end answers duplicate and writes no second posting", async () => {
      const eventId = await seedLiveEvent(60);
      const doctor = await attendingDoctor(eventId, beatsFor(50, 60));

      await events.closeRoom(eventId, null);
      credited.splice(0);

      // Replay the end's report against the committed end.
      const db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
      const publish = await db.transaction((tx) =>
        producer.recordEventEnd(tx, {
          id: eventId,
          durationMin: 60,
          endedAt: new Date(),
        }),
      );
      await publish();

      expect(await balanceOf(doctor.userId)).toEqual({ bre: 2, con: 1 });
      expect(await journalOf(eventId, doctor.userId)).toHaveLength(1);
      expect(credited).toEqual([]);
    });
  },
);

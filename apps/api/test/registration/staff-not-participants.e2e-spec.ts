import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { DoctorEventsRepository } from "../../src/storefront/doctor-events.repository.js";
import { RegistrationRepository } from "../../src/registration/registration.repository.js";
import { PresenceRepository } from "../../src/room/presence.repository.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// #2456 — a staff account is a user (it holds the visitor role, so it can sign
// up and enter a room like anyone), but it is NEVER a participant: its
// registrations and presence must not inflate the «сколько коллег записалось»
// figure, the congress roster (rows and total), the roster read model, or the
// live room population / presence minutes. The staff marker is the `users.role`
// mirror the session keeps in step with the project-roles claim.
//
// Seeds rows directly and reads through the real repositories against the
// dev-stand Postgres; skips when DATABASE_URL or IDP_ISSUER is absent, like the
// sibling e2e suites.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "003 EARS-26 staff accounts are filtered out of participant queries (#2456, e2e)",
  () => {
    let moduleRef: TestingModule;
    let pool: pg.Pool;
    let doctorEvents: DoctorEventsRepository;
    let registrationRepo: RegistrationRepository;
    let presence: PresenceRepository;
    const createdSubs: string[] = [];
    const createdEventIds: string[] = [];

    async function seedUser(role: string): Promise<string> {
      const sub = `staff-2456-${randomUUID()}`;
      createdSubs.push(sub);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (zitadel_sub, email, role)
         VALUES ($1, $2, $3) RETURNING id`,
        [sub, `${sub}@ds.test`, role],
      );
      return rows[0]!.id;
    }

    async function seedEvent(): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${eventClassificationSql()})`,
        [
          id,
          `staff2456-${id.slice(0, 8)}`,
          "Эфир для участников",
          "Кардиология сегодня",
          "2026-07-17T16:00:00.000Z",
          90,
          "Разбор клинических рекомендаций.",
          ["cardiology"],
          "sponsor:acme-pharma",
          null,
          "live",
        ],
      );
      createdEventIds.push(id);
      return id;
    }

    async function register(userId: string, eventId: string): Promise<void> {
      await pool.query(
        `INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)`,
        [userId, eventId],
      );
    }

    async function beat(userId: string, eventId: string): Promise<void> {
      await pool.query(
        `INSERT INTO presence_beats (user_id, event_id) VALUES ($1, $2)`,
        [userId, eventId],
      );
    }

    /** One event with a doctor and a staff member, both signed up and in the room. */
    async function mixedEvent(): Promise<{
      eventId: string;
      doctorId: string;
      staffId: string;
    }> {
      const eventId = await seedEvent();
      const doctorId = await seedUser("doctor_guest");
      const staffId = await seedUser("platform_admin");
      await register(doctorId, eventId);
      await register(staffId, eventId);
      await beat(doctorId, eventId);
      await beat(staffId, eventId);
      return { eventId, doctorId, staffId };
    }

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      pool = moduleRef.get<pg.Pool>(DRIZZLE_POOL);
      doctorEvents = moduleRef.get(DoctorEventsRepository);
      registrationRepo = moduleRef.get(RegistrationRepository);
      presence = moduleRef.get(PresenceRepository);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      for (const sub of createdSubs.splice(0))
        await deleteUserFixture(pool, "zitadel_sub", sub);
    });

    afterAll(async () => {
      await moduleRef.close();
    });

    it("EARS-26: the storefront sign-up count counts the doctor, never the staff member", async () => {
      const { eventId } = await mixedEvent();

      const counts = await doctorEvents.countSignUps([eventId]);

      expect(counts.get(eventId)).toBe(1);
    });

    it("EARS-26: the roster read model lists only participants", async () => {
      const { eventId, doctorId } = await mixedEvent();

      const roster = await registrationRepo.findEventRoster(eventId);

      expect(roster.map((r) => r.userId)).toEqual([doctorId]);
    });

    it("EARS-26: the registrar's roster page excludes staff rows from both the rows and the total", async () => {
      const { eventId } = await mixedEvent();

      const page = await registrationRepo.findEventRosterPage(
        eventId,
        { page: 1, pageSize: 50 },
        [],
      );

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(1);
    });

    it("EARS-26: the live room population counts the doctor, never the staff member", async () => {
      const { eventId } = await mixedEvent();

      expect(await presence.countLivePresence(eventId, 60)).toBe(1);
    });

    it("EARS-26: derived presence minutes carry no staff rows", async () => {
      const { eventId, doctorId } = await mixedEvent();

      const minutes = await presence.deriveEventMinutes(eventId, 30);

      expect(minutes.map((m) => m.userId)).toEqual([doctorId]);
    });
  },
);

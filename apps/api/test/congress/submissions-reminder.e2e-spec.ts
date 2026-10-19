import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  congressSubmissionReminderMessage,
  formatClosingLastDay,
} from "../../src/mailer/notice-emails.js";
import {
  CONGRESS_SUBMISSION_REMINDER_JOB,
  CongressSubmissionReminderService,
} from "../../src/congress/congress-submission-reminder.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 046 EARS-33 — the deadline reminder: the scheduled sweep and its letter.
 * Verification row V-13.
 *
 * The sweep body is driven directly (`runOnce()`) on the REAL module against
 * the dev-stand Postgres; the 15-minute cron itself is kept stopped by the
 * shared runner setup in every suite, so no tick — here or in another suite —
 * can claim a fixture between a seed and an assertion. Closing
 * instants are seeded relative to now. Letters are read per recipient, so a
 * due kind of another fixture never disturbs an assertion.
 *
 * Skips when DATABASE_URL or IDP_ISSUER is absent so the shared CI unit job
 * stays green.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CABINET_ENTRY_DOMAIN = "orthobio.ru";

type Kind = "oral" | "poster" | "abstract";
type Window = { opensAt: Date | null; closesAt: Date | null };

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "046 congress submissions — the deadline reminder (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let sweep: CongressSubmissionReminderService;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    type Doctor = { userId: string; email: string };

    async function doctor(prefix: string): Promise<Doctor> {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return { userId: rows[0]!.id, email };
    }

    /** A congress event with the given kinds' intake windows. */
    async function congress(
      windows: Partial<Record<Kind, Window>>,
    ): Promise<string> {
      const id = randomUUID();
      createdEventIds.push(id);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,'Конгресс','Конгресс','2027-04-23T09:00:00.000Z',480,
                 'Ежегодный конгресс.',$3,'sponsor:congress',NULL,'published',
                 'offline', ${eventClassificationSql()})`,
        [id, `congress-rem-${id.slice(0, 8)}`, ["cardiology"]],
      );
      await pool.query(
        `INSERT INTO congress_submission_settings (event_id, registration_url)
         VALUES ($1, 'https://orthobio.ru/registration')`,
        [id],
      );
      for (const [kind, window] of Object.entries(windows)) {
        await pool.query(
          `INSERT INTO congress_submission_kind_settings
             (event_id, kind, opens_at, closes_at)
           VALUES ($1, $2, $3, $4)`,
          [id, kind, window.opensAt, window.closesAt],
        );
      }
      return id;
    }

    /** An open window closing `hours` from now. */
    const closingIn = (hours: number): Window => ({
      opensAt: new Date(Date.now() - 10 * DAY),
      closesAt: new Date(Date.now() + hours * HOUR),
    });

    async function register(d: Doctor, eventId: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)
         RETURNING id`,
        [d.userId, eventId],
      );
      return rows[0]!.id;
    }

    async function submission(
      d: Doctor,
      eventId: string,
      registrationId: string,
      kind: Kind,
      title: string,
      status = "draft",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO congress_submissions
           (event_id, registration_id, user_id, kind, title, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [eventId, registrationId, d.userId, kind, title, status],
      );
      return rows[0]!.id;
    }

    async function row(id: string) {
      const { rows } = await pool.query<{
        status: string;
        last_letter_kind: string | null;
        last_letter_status: string | null;
        last_letter_at: Date | null;
      }>(
        `SELECT status, last_letter_kind, last_letter_status, last_letter_at
           FROM congress_submissions WHERE id = $1`,
        [id],
      );
      return rows[0]!;
    }

    const reminders = (d: Doctor) =>
      mailer.congressSubmissionReminders.filter(
        (r) => r.to === d.email.toLowerCase(),
      );

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      sweep = app.get(CongressSubmissionReminderService);
      // The shared runner setup (`test/setup/test-env.ts`) keeps this job
      // stopped in every suite; pin that here by the exported name.
      expect(
        app.get(SchedulerRegistry).getCronJob(CONGRESS_SUBMISSION_REMINDER_JOB)
          .isActive,
      ).toBe(false);
    });

    afterAll(async () => {
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        for (const id of createdEventIds.splice(0))
          await deleteEventFixture(pool, id);
      }
      await app?.close();
    });

    it("EARS-33: when a kind closes within 72 hours, the system shall send the draft's author one reminder with the draft and the last day, no link and the cabinet paragraph, and record it", async () => {
      const window = closingIn(72 - 0.1);
      const eventId = await congress({ oral: window });
      const d = await doctor("rem-one");
      const draft = await submission(
        d,
        eventId,
        await register(d, eventId),
        "oral",
        "Ранняя реабилитация",
      );

      await sweep.runOnce();

      const sent = reminders(d);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        kindGenitivePlural: CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL.oral,
        titles: ["Ранняя реабилитация"],
        closesAt: window.closesAt,
      });
      const message = congressSubmissionReminderMessage({
        kindGenitivePlural: sent[0]!.kindGenitivePlural,
        titles: sent[0]!.titles,
        lastDay: formatClosingLastDay(sent[0]!.closesAt),
      });
      const lastDay = formatClosingLastDay(window.closesAt!);
      for (const part of [message.text, message.html]) {
        expect(part).toContain("Ранняя реабилитация");
        expect(part).toContain(lastDay);
        expect(part).toContain(CABINET_ENTRY_DOMAIN);
        expect(part).not.toMatch(/https?:\/\/|href=/);
      }
      expect(await row(draft)).toMatchObject({
        status: "draft",
        last_letter_kind: "reminder",
        last_letter_status: "sent",
      });
      expect((await row(draft)).last_letter_at).not.toBeNull();
    });

    it("EARS-33: when the sweep runs again, or twice in parallel, the system shall not send a second reminder for the same closing instant", async () => {
      const eventId = await congress({ oral: closingIn(48) });
      const d = await doctor("rem-again");
      await submission(d, eventId, await register(d, eventId), "oral", "Тема");

      await Promise.all([sweep.runOnce(), sweep.runOnce()]);
      expect(reminders(d)).toHaveLength(1);

      await sweep.runOnce();
      expect(reminders(d)).toHaveLength(1);
    });

    it("EARS-33: when the closing instant moves, the system shall send one new reminder", async () => {
      const eventId = await congress({ oral: closingIn(24) });
      const d = await doctor("rem-moved");
      await submission(d, eventId, await register(d, eventId), "oral", "Тема");
      await sweep.runOnce();
      expect(reminders(d)).toHaveLength(1);

      const moved = new Date(Date.now() + 60 * HOUR);
      await pool.query(
        `UPDATE congress_submission_kind_settings SET closes_at = $2
          WHERE event_id = $1 AND kind = 'oral'`,
        [eventId, moved],
      );
      await sweep.runOnce();
      await sweep.runOnce();

      expect(reminders(d)).toHaveLength(2);
      expect(reminders(d)[1]!.closesAt).toEqual(moved);
    });

    it("EARS-33: when an account holds two drafts of a kind, the system shall send one reminder listing both, and none for a closing kind without its drafts", async () => {
      const eventId = await congress({
        oral: closingIn(30),
        poster: closingIn(30),
      });
      const d = await doctor("rem-two");
      const registrationId = await register(d, eventId);
      const first = await submission(
        d,
        eventId,
        registrationId,
        "oral",
        "Первая тема",
      );
      const second = await submission(d, eventId, registrationId, "oral", "");

      await sweep.runOnce();

      const sent = reminders(d);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.kindGenitivePlural).toBe(
        CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL.oral,
      );
      expect([...sent[0]!.titles].sort()).toEqual(["", "Первая тема"]);
      for (const id of [first, second])
        expect(await row(id)).toMatchObject({
          last_letter_kind: "reminder",
          last_letter_status: "sent",
        });
    });

    it("EARS-33: when a draft is added after the reminder for the same closing instant, the system shall not remind the account again", async () => {
      const eventId = await congress({ oral: closingIn(30) });
      const d = await doctor("rem-later");
      const registrationId = await register(d, eventId);
      await submission(d, eventId, registrationId, "oral", "Первая");
      await sweep.runOnce();
      expect(reminders(d)).toHaveLength(1);

      await submission(d, eventId, registrationId, "oral", "Вторая");
      await sweep.runOnce();

      expect(reminders(d)).toHaveLength(1);
    });

    it("EARS-33: when the kind closes more than 72 hours away, has already closed or has no window, the system shall send no reminder", async () => {
      const far = await congress({ oral: closingIn(73) });
      const closed = await congress({
        oral: {
          opensAt: new Date(Date.now() - 10 * DAY),
          closesAt: new Date(Date.now() - HOUR),
        },
      });
      const unset = await congress({ oral: { opensAt: null, closesAt: null } });
      const d = await doctor("rem-none");
      for (const eventId of [far, closed, unset])
        await submission(
          d,
          eventId,
          await register(d, eventId),
          "oral",
          "Тема",
        );

      await sweep.runOnce();

      expect(reminders(d)).toHaveLength(0);
    });

    it("EARS-33: when the account holds only sent or deleted submissions of the kind, the system shall send no reminder", async () => {
      const eventId = await congress({ oral: closingIn(30) });
      const d = await doctor("rem-sent");
      const registrationId = await register(d, eventId);
      await submission(
        d,
        eventId,
        registrationId,
        "oral",
        "Отправлена",
        "submitted",
      );
      const retired = await submission(
        d,
        eventId,
        registrationId,
        "oral",
        "Удалена",
      );
      await pool.query(
        `UPDATE congress_submissions
            SET record_status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [retired],
      );

      await sweep.runOnce();

      expect(reminders(d)).toHaveLength(0);
    });

    it("EARS-33: when the letter fails, the system shall record the failure and leave the draft's status unchanged", async () => {
      const eventId = await congress({ oral: closingIn(30) });
      const d = await doctor("rem-fail");
      const draft = await submission(
        d,
        eventId,
        await register(d, eventId),
        "oral",
        "Тема",
      );

      mailer.failNextSubmissionReminder(new Error("relay down"));
      await sweep.runOnce();

      expect(reminders(d)).toHaveLength(0);
      expect(await row(draft)).toMatchObject({
        status: "draft",
        last_letter_kind: "reminder",
        last_letter_status: "failed",
      });
    });

    it("EARS-33: when two accounts hold drafts of the same kind, the system shall send each account its own reminder", async () => {
      const eventId = await congress({ oral: closingIn(30) });
      const first = await doctor("rem-acc-a");
      const second = await doctor("rem-acc-b");
      await submission(
        first,
        eventId,
        await register(first, eventId),
        "oral",
        "Тема первого",
      );
      await submission(
        second,
        eventId,
        await register(second, eventId),
        "oral",
        "Тема второго",
      );

      await sweep.runOnce();

      expect(reminders(first).map((r) => r.titles)).toEqual([["Тема первого"]]);
      expect(reminders(second).map((r) => r.titles)).toEqual([
        ["Тема второго"],
      ]);
    });

    it("EARS-33: when claiming one kind fails, the system shall still remind the drafts of the other closing kinds", async () => {
      const broken = await congress({ oral: closingIn(1) });
      const healthy = await congress({ oral: closingIn(2) });
      const a = await doctor("rem-iso-a");
      const b = await doctor("rem-iso-b");
      await submission(a, broken, await register(a, broken), "oral", "Тема");
      await submission(b, healthy, await register(b, healthy), "oral", "Тема");

      const target = sweep as unknown as {
        claim: (eventId: string, ...rest: unknown[]) => Promise<unknown>;
      };
      const original = target.claim.bind(sweep);
      const spy = vi
        .spyOn(target, "claim")
        .mockImplementation((eventId, ...rest) =>
          eventId === broken
            ? Promise.reject(new Error("claim failed"))
            : original(eventId, ...rest),
        );
      try {
        await sweep.runOnce();
      } finally {
        spy.mockRestore();
      }

      expect(reminders(a)).toHaveLength(0);
      expect(reminders(b)).toHaveLength(1);
    });

    it("EARS-33: when the closing instant moves between the sweep's read and its claim, the system shall claim and name the current instant", async () => {
      const eventId = await congress({ oral: closingIn(24) });
      const d = await doctor("rem-race");
      const draft = await submission(
        d,
        eventId,
        await register(d, eventId),
        "oral",
        "Тема",
      );
      const moved = new Date(Date.now() + 60 * HOUR);

      const target = sweep as unknown as {
        claim: (eventId: string, ...rest: unknown[]) => Promise<unknown>;
      };
      const original = target.claim.bind(sweep);
      const spy = vi
        .spyOn(target, "claim")
        .mockImplementation(async (claimedEvent, ...rest) => {
          if (claimedEvent === eventId)
            await pool.query(
              `UPDATE congress_submission_kind_settings SET closes_at = $2
                WHERE event_id = $1 AND kind = 'oral'`,
              [eventId, moved],
            );
          return original(claimedEvent, ...rest);
        });
      try {
        await sweep.runOnce();
      } finally {
        spy.mockRestore();
      }

      expect(reminders(d).map((r) => r.closesAt)).toEqual([moved]);
      const { rows } = await pool.query<{ reminded_for_closes_at: Date }>(
        `SELECT reminded_for_closes_at FROM congress_submissions WHERE id = $1`,
        [draft],
      );
      expect(rows[0]!.reminded_for_closes_at).toEqual(moved);

      await sweep.runOnce();
      expect(reminders(d)).toHaveLength(1);
    });
  },
);

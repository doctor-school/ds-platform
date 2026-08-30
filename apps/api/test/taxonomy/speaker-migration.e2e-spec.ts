import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

interface MigrationReviewItem {
  sourceId: string;
  eventId: string;
  sourcePosition: number;
  sourceName: string;
  sourceRegalia: string;
  originalClassification: "unmatched" | "ambiguous" | "duplicate";
  resolution: null | Record<string, unknown>;
  [key: string]: unknown;
}

interface MigrationReviewPage {
  data: MigrationReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-24 retained speaker migration review queue (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "SpeakerMigrationTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];
    const createdSpeakerIds: string[] = [];
    let adminSid: string;

    async function createAdminSession(): Promise<string> {
      const email = `speaker-migration-${randomUUID()}@ds.test`;
      createdEmails.push(email);
      const registration = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(registration.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      return (
        await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        })
      ).sid;
    }

    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, $3, now(), 60) RETURNING id`,
        [`e-1607-${randomUUID()}`, "Speaker migration", "Doctor School"],
      );
      createdEventIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertSpeaker(
      eventId: string,
      position: number,
      name: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [eventId, position, name, "MD"],
      );
      createdSpeakerIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertSameNamedEligibleExpert(name: string): Promise<void> {
      const [familyName, givenName] = name.split(" ");
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts
           (slug, family_name, given_name, status, first_published_at)
         VALUES ($1, $2, $3, 'published', now()) RETURNING id`,
        [`x-1607-${randomUUID()}`, familyName, givenName],
      );
      createdExpertIds.push(rows[0]!.id);
    }

    async function listQueue(): Promise<MigrationReviewPage> {
      const response = await app.inject({
        method: "GET",
        url: "/v1/admin/speaker-migration-reviews?page=1&pageSize=100",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.payload) as MigrationReviewPage;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
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
      adminSid = await createAdminSession();
    });

    afterEach(async () => {
      const reviewTable = await pool.query<{ name: string | null }>(
        "SELECT to_regclass('public.speaker_migration_reviews')::text AS name",
      );
      if (reviewTable.rows[0]?.name) {
        await pool.query(
          "DELETE FROM speaker_migration_reviews WHERE source_speaker_id = ANY($1::uuid[])",
          [createdSpeakerIds],
        );
      }
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM event_speakers WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      createdSpeakerIds.splice(0);
      for (const id of createdExpertIds.splice(0)) {
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    it("EARS-24: when migration review opens, every retained event_speakers row shall be queued exactly once with immutable original classification and no eligibility or name matching", async () => {
      const eventId = await insertEvent();
      const sharedName = "Ivanov Ivan";
      const sourceIds = [
        await insertSpeaker(eventId, 0, sharedName),
        await insertSpeaker(eventId, 1, sharedName),
        await insertSpeaker(eventId, 2, "Petrov Petr"),
      ];
      await insertSameNamedEligibleExpert(sharedName);

      const first = await listQueue();
      const retained = first.data.filter((item) => sourceIds.includes(item.sourceId));

      expect(retained).toHaveLength(sourceIds.length);
      expect(new Set(retained.map((item) => item.sourceId))).toEqual(
        new Set(sourceIds),
      );
      expect(retained.every((item) => item.eventId === eventId)).toBe(true);
      expect(
        retained.every((item) =>
          ["unmatched", "ambiguous", "duplicate"].includes(
            item.originalClassification,
          ),
        ),
      ).toBe(true);
      expect(
        retained.every(
          (item) =>
            !("suggestedExpertId" in item) &&
            !("suggestedExpertName" in item) &&
            !("matchedExpertId" in item),
        ),
      ).toBe(true);

      const second = await listQueue();
      const originalBySource = new Map(
        retained.map((item) => [item.sourceId, item.originalClassification]),
      );
      expect(
        second.data
          .filter((item) => sourceIds.includes(item.sourceId))
          .map((item) => [item.sourceId, item.originalClassification]),
      ).toEqual(
        expect.arrayContaining([...originalBySource.entries()]),
      );
    });
  },
);

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
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
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
  disposition:
    | "unresolved"
    | "existing_expert"
    | "created_expert"
    | "content_removed";
  resolvedExpertId: string | null;
  eventExpertId: string | null;
  reviewerId: string | null;
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
      expect(registration.statusCode, registration.payload).toBe(200);
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

    async function insertEligibleExpert(name: string): Promise<string> {
      const [familyName, givenName] = name.split(" ");
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts
           (slug, family_name, given_name, status, first_published_at)
         VALUES ($1, $2, $3, 'published', now()) RETURNING id`,
        [`x-1607-${randomUUID()}`, familyName, givenName],
      );
      createdExpertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function classify(
      sourceId: string,
      classification: MigrationReviewItem["originalClassification"],
    ): Promise<void> {
      await pool.query(
        "DELETE FROM speaker_migration_reviews WHERE source_speaker_id = $1",
        [sourceId],
      );
      await pool.query(
        `INSERT INTO speaker_migration_reviews
           (source_speaker_id, event_id, source_position, source_name,
            source_regalia, content_fingerprint, original_classification)
         SELECT id, event_id, position, name, regalia,
                encode(digest(concat_ws(E'\\x1f', event_id::text,
                  position::text, name, regalia), 'sha256'), 'hex'), $2
           FROM event_speakers WHERE id = $1`,
        [sourceId, classification],
      );
    }

    async function resolve(
      sourceId: string,
      payload: Record<string, unknown>,
      key = randomUUID(),
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/speaker-migration-reviews/${sourceId}/resolve`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "idempotency-key": key,
        },
        payload,
      });
    }

    async function cutover(key = randomUUID()) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/speaker-migration-reviews/cutover",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "idempotency-key": key,
        },
      });
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
        .overrideProvider(BOT_PROTECTION)
        .useValue({
          verify: (): Promise<BotProtectionResult> =>
            Promise.resolve({ ok: true }),
        } satisfies BotProtection)
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
          "DELETE FROM speaker_migration_cutover WHERE id = 'speaker_migration'",
        );
        await pool.query(
          `INSERT INTO speaker_migration_cutover (id, status)
           VALUES ('speaker_migration', 'pre_cutover')`,
        );
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
      await insertEligibleExpert(sharedName);

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

      await expect(
        pool.query(
          `UPDATE speaker_migration_reviews
             SET original_classification = 'duplicate'
           WHERE source_speaker_id = $1`,
          [sourceIds[0]],
        ),
      ).rejects.toThrow(/provenance.*immutable/);
    });

    it("EARS-24: when each retained row is explicitly resolved, the platform shall write one canonical outcome and an auditable immutable decision without implicit matching", async () => {
      const eventId = await insertEvent();
      const sourceExisting = await insertSpeaker(eventId, 0, "Same Name");
      const sourceCreated = await insertSpeaker(eventId, 1, "Legacy Imported");
      const sourceRemoved = await insertSpeaker(eventId, 2, "Remove Me");
      await classify(sourceCreated, "ambiguous");
      await classify(sourceRemoved, "duplicate");
      const selectedExpertId = await insertEligibleExpert("Same Name");

      const existingKey = randomUUID();
      const existingPayload = {
        disposition: "existing_expert",
        expertId: selectedExpertId,
        role: "speaker",
        position: 0,
      };
      const first = await resolve(sourceExisting, existingPayload, existingKey);
      const replay = await resolve(sourceExisting, existingPayload, existingKey);
      expect(first.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(JSON.parse(replay.payload)).toEqual(JSON.parse(first.payload));

      const created = await resolve(sourceCreated, {
        disposition: "created_expert",
        expert: {
          familyName: "Imported",
          givenName: "Doctor",
          professionalRole: "Cardiologist",
        },
        role: "moderator",
        position: 1,
      });
      expect(created.statusCode).toBe(200);

      const removed = await resolve(sourceRemoved, {
        disposition: "content_removed",
      });
      expect(removed.statusCode).toBe(200);

      const outcomes = [first, created, removed].map(
        (response) => JSON.parse(response.payload) as MigrationReviewItem,
      );
      expect(outcomes.map((item) => item.disposition)).toEqual([
        "existing_expert",
        "created_expert",
        "content_removed",
      ]);
      expect(outcomes[0]!.resolvedExpertId).toBe(selectedExpertId);
      expect(outcomes[1]!.resolvedExpertId).toBeTruthy();
      expect(outcomes[2]!.eventExpertId).toBeNull();

      const links = await pool.query<{
        legacy_speaker_id: string;
        expert_id: string;
      }>(
        `SELECT legacy_speaker_id, expert_id FROM event_experts
          WHERE legacy_speaker_id = ANY($1::uuid[]) ORDER BY position`,
        [[sourceExisting, sourceCreated, sourceRemoved]],
      );
      expect(links.rows).toEqual([
        { legacy_speaker_id: sourceExisting, expert_id: selectedExpertId },
        {
          legacy_speaker_id: sourceCreated,
          expert_id: outcomes[1]!.resolvedExpertId,
        },
      ]);

      const audit = await pool.query<{
        metadata: Record<string, unknown>;
      }>(
        `SELECT metadata FROM audit_ledger
          WHERE event_type = 'SpeakerMigrationReviewResolved'
            AND metadata->>'sourceSpeakerId' = $1`,
        [sourceCreated],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.metadata).toMatchObject({
        sourceSpeakerId: sourceCreated,
        eventId,
        originalClassification: "ambiguous",
        disposition: "created_expert",
        reviewerId: outcomes[1]!.reviewerId,
      });
    });

    it("EARS-24: when any retained row remains unresolved, cutover shall refuse and leave legacy reads and writes enabled", async () => {
      const eventId = await insertEvent();
      const sourceId = await insertSpeaker(eventId, 0, "Still Unresolved");

      const response = await cutover();
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });
      const state = await pool.query<{ status: string }>(
        "SELECT status FROM speaker_migration_cutover WHERE id = 'speaker_migration'",
      );
      expect(state.rows[0]!.status).toBe("pre_cutover");

      const additional = await insertSpeaker(eventId, 1, "Still Writable");
      expect([sourceId, additional]).toHaveLength(2);
    });

    it("EARS-24: when every retained row has a terminal outcome, cutover shall retain provenance and serve only canonical Experts while rejecting every free-text write", async () => {
      const eventId = await insertEvent();
      const sourceExpert = await insertSpeaker(eventId, 0, "Canonical Doctor");
      const sourceRemoved = await insertSpeaker(eventId, 1, "Remove Legacy");
      const expertId = await insertEligibleExpert("Canonical Doctor");
      await pool.query("UPDATE events SET state = 'published' WHERE id = $1", [
        eventId,
      ]);

      expect(
        (await resolve(sourceExpert, {
          disposition: "existing_expert",
          expertId,
          role: "speaker",
          position: 0,
        })).statusCode,
      ).toBe(200);
      expect(
        (await resolve(sourceRemoved, { disposition: "content_removed" }))
          .statusCode,
      ).toBe(200);

      const response = await cutover();
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toMatchObject({
        status: "cutover",
        resolved: 1,
        contentRemoved: 1,
      });

      const publicRead = await app.inject({
        method: "GET",
        url: `/v1/public/events/${eventId}/speakers`,
      });
      expect(publicRead.statusCode).toBe(200);
      expect(JSON.parse(publicRead.payload)).toEqual([
        expect.objectContaining({
          source: "expert",
          expertId,
          name: "Canonical Doctor",
        }),
      ]);

      const retained = await pool.query<{ id: string }>(
        "SELECT id FROM event_speakers WHERE event_id = $1 ORDER BY position",
        [eventId],
      );
      expect(retained.rows.map((row) => row.id)).toEqual([
        sourceExpert,
        sourceRemoved,
      ]);
      await expect(
        pool.query(
          `INSERT INTO event_speakers (event_id, position, name, regalia)
           VALUES ($1, 2, 'Forbidden', 'MD')`,
          [eventId],
        ),
      ).rejects.toThrow(/disabled after canonical cutover/);
      await expect(
        pool.query("UPDATE event_speakers SET name = name WHERE id = $1", [
          sourceExpert,
        ]),
      ).rejects.toThrow(/disabled after canonical cutover/);
    });
  },
);

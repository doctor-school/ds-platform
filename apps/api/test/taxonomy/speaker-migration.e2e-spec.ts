import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
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

/**
 * 012 EARS-24 (#1607) — the provenance-safe legacy-speaker migration: the review
 * queue, its explicit resolutions and the guarded source closure, driven over
 * HTTP against REAL migrated Postgres rows on the branch database.
 *
 * Numbering continues `test/db/speaker-migration-fence.e2e-spec.ts` (#1633,
 * `012 EARS-24.1`–`.19`), which owns the database-level SSOT and fence
 * assertions. This file starts at `.20` and owns the application contract.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE, because it must not exist: any name
 * comparison, normalization, candidate list, suggested Expert or inferred
 * identity. `.23` asserts the absence of such fields on the wire; every
 * resolution below names its target explicitly.
 */

interface MigrationReviewItem {
  sourceId: string;
  eventId: string;
  sourcePosition: number;
  sourceName: string;
  sourceRegalia: string;
  contentFingerprint: string;
  originalClassification: "unmatched" | "ambiguous" | "duplicate";
  disposition:
    | "unresolved"
    | "existing_expert"
    | "created_expert"
    | "content_removed";
  resolvedExpertId: string | null;
  eventExpertId: string | null;
  resolvedRole: string | null;
  resolvedPosition: number | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  [key: string]: unknown;
}

interface MigrationReviewPage {
  data: MigrationReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

const SHA_EXPAND = "a".repeat(40);
/** RFC 7578 line separator - multipart bodies are CRLF-delimited. */
const CRLF = String.fromCharCode(13, 10);

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-24 provenance-safe speaker migration — queue, resolution, closure (e2e)",
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

    /**
     * Run `fn` with the named row triggers of `table` disabled.
     *
     * FIXTURE SURGERY, and only ever fixture surgery. Two things this suite must
     * arrange are unrepresentable through the product surface BY DESIGN:
     *  - a source row that predates the expand release (no review), which is the
     *    entire population the import exists for — after expand every INSERT is
     *    auto-enqueued;
     *  - teardown of retained rows and a one-way phase, which the product
     *    correctly refuses forever.
     * Nothing under test runs inside this helper: every assertion below is made
     * against the triggers ENABLED.
     */
    async function withTriggersDisabled<T>(
      table: string,
      triggers: readonly string[],
      fn: () => Promise<T>,
    ): Promise<T> {
      for (const trigger of triggers) {
        await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      try {
        return await fn();
      } finally {
        for (const trigger of triggers) {
          await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
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

    /** A source row as it exists at expand time: retained, and NOT yet queued. */
    async function insertPreExpandSpeaker(
      eventId: string,
      position: number,
      name: string,
      opts: { contentRemoved?: boolean } = {},
    ): Promise<string> {
      return withTriggersDisabled(
        "event_speakers",
        ["event_speakers_enqueue_review_after_insert"],
        async () => {
          const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO event_speakers
               (event_id, position, name, regalia, content_removed_at)
             VALUES ($1, $2, $3, 'MD', $4) RETURNING id`,
            [eventId, position, name, opts.contentRemoved ? new Date() : null],
          );
          createdSpeakerIds.push(rows[0]!.id);
          return rows[0]!.id;
        },
      );
    }

    /** A source row inserted DURING `review_open` — the trigger must queue it. */
    async function insertLiveSpeaker(
      eventId: string,
      position: number,
      name: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1, $2, $3, 'MD') RETURNING id`,
        [eventId, position, name],
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

    function post(url: string, payload?: unknown, key = randomUUID()) {
      return app.inject({
        method: "POST",
        url,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "idempotency-key": key,
        },
        ...(payload === undefined ? {} : { payload }),
      });
    }

    const BASE = "/v1/admin/speaker-migration-reviews";

    function importRows(
      reviewedRows: { sourceId: string; classification: string }[],
      key = randomUUID(),
    ) {
      return post(`${BASE}/import`, { reviewedRows }, key);
    }

    function recordRelease(
      releaseSha = SHA_EXPAND,
      releaseOrdinal = 11,
      key = randomUUID(),
    ) {
      return post(
        `${BASE}/phase-aware-release`,
        { releaseSha, releaseOrdinal },
        key,
      );
    }

    function resolve(
      sourceId: string,
      payload: Record<string, unknown>,
      key = randomUUID(),
    ) {
      return post(`${BASE}/${sourceId}/resolve`, payload, key);
    }

    function closeSource(key = randomUUID()) {
      return post(`${BASE}/close-source`, undefined, key);
    }

    async function listQueue(): Promise<MigrationReviewPage> {
      const response = await app.inject({
        method: "GET",
        url: `${BASE}?page=1&pageSize=100`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(response.statusCode, response.payload).toBe(200);
      return JSON.parse(response.payload) as MigrationReviewPage;
    }

    async function phaseRow(): Promise<{
      phase: string;
      minimum_compatible_release_sha: string | null;
      minimum_compatible_release_ordinal: number | null;
      phase_aware_release_sha: string | null;
    }> {
      const { rows } = await pool.query(
        `SELECT phase, minimum_compatible_release_sha,
                minimum_compatible_release_ordinal, phase_aware_release_sha
           FROM speaker_migration_cutover`,
      );
      return rows[0];
    }

    async function queuedCountFor(sourceIds: string[]): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM speaker_migration_reviews
          WHERE source_speaker_id = ANY($1::uuid[])`,
        [sourceIds],
      );
      return Number(rows[0]!.n);
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
      // `POST /v1/admin/events` is multipart-only; `.31` drives the free-text
      // refusal through it, so the parser must be registered as the app does.
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await createAdminSession();
    });

    afterEach(async () => {
      // Retained provenance and a one-way phase are product guarantees; a test
      // fixture is the one place they are unwound, with the guards off.
      await withTriggersDisabled(
        "speaker_migration_reviews",
        ["speaker_migration_reviews_guard_before_write"],
        () => pool.query("DELETE FROM speaker_migration_reviews"),
      );
      await withTriggersDisabled(
        "speaker_migration_cutover",
        ["speaker_migration_cutover_guard_before_write"],
        () =>
          pool.query(
            `UPDATE speaker_migration_cutover
                SET phase = 'review_open',
                    phase_aware_release_sha = NULL,
                    phase_aware_release_ordinal = NULL,
                    minimum_compatible_release_sha = NULL,
                    minimum_compatible_release_ordinal = NULL,
                    phase_advanced_at = NULL,
                    source_import_completed_at = NULL`,
          ),
      );
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await withTriggersDisabled(
          "event_speakers",
          ["event_speakers_migration_fence_before_write"],
          () => pool.query("DELETE FROM event_speakers WHERE event_id = $1", [id]),
        );
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

    // ── Import: the owner-reviewed artifact is validated, never inferred ────

    it("012 EARS-24.20: an artifact missing a retained source row is refused before any write", async () => {
      const eventId = await insertEvent();
      const covered = await insertPreExpandSpeaker(eventId, 0, "Ivanov Ivan");
      const omitted = await insertPreExpandSpeaker(eventId, 1, "Petrov Petr");

      const response = await importRows([
        { sourceId: covered, classification: "unmatched" },
      ]);

      expect(response.statusCode).toBe(400);
      const problem = JSON.parse(response.payload) as {
        errorCode: string;
        errors: { path: string; message: string }[];
      };
      expect(problem.errorCode).toBe("VALIDATION_FAILED");
      expect(problem.errors).toContainEqual({
        path: "reviewedRows",
        message: `missing source ${omitted}`,
      });
      expect(await queuedCountFor([covered, omitted])).toBe(0);
    });

    it("012 EARS-24.21: an artifact repeating a source row is refused, never collapsed to last-one-wins", async () => {
      const eventId = await insertEvent();
      const twice = await insertPreExpandSpeaker(eventId, 0, "Ivanov Ivan");

      const response = await importRows([
        { sourceId: twice, classification: "unmatched" },
        { sourceId: twice, classification: "duplicate" },
      ]);

      expect(response.statusCode).toBe(400);
      const problem = JSON.parse(response.payload) as {
        errorCode: string;
        errors: { path: string; message: string }[];
      };
      expect(problem.errorCode).toBe("VALIDATION_FAILED");
      expect(problem.errors).toContainEqual({
        path: "reviewedRows",
        message: `repeated source ${twice}`,
      });
      expect(await queuedCountFor([twice])).toBe(0);
    });

    it("012 EARS-24.22: an artifact naming a UUID that is not a retained source row is refused", async () => {
      const eventId = await insertEvent();
      const real = await insertPreExpandSpeaker(eventId, 0, "Ivanov Ivan");
      const alien = randomUUID();

      const response = await importRows([
        { sourceId: real, classification: "unmatched" },
        { sourceId: alien, classification: "ambiguous" },
      ]);

      expect(response.statusCode).toBe(400);
      const problem = JSON.parse(response.payload) as {
        errorCode: string;
        errors: { path: string; message: string }[];
      };
      expect(problem.errorCode).toBe("VALIDATION_FAILED");
      expect(problem.errors).toContainEqual({
        path: "reviewedRows",
        message: `extra source ${alien}`,
      });
      expect(await queuedCountFor([real])).toBe(0);
    });

    it("012 EARS-24.23: every retained source row — content-removed included — is queued exactly once with its reviewed classification and no suggestion field", async () => {
      const eventId = await insertEvent();
      const shared = "Ivanov Ivan";
      const unmatched = await insertPreExpandSpeaker(eventId, 0, shared);
      const ambiguous = await insertPreExpandSpeaker(eventId, 1, shared);
      const duplicate = await insertPreExpandSpeaker(eventId, 2, "Petrov Petr");
      const removed = await insertPreExpandSpeaker(eventId, 3, "Gone Person", {
        contentRemoved: true,
      });
      // An eligible Expert with the SAME name exists and must change nothing.
      await insertEligibleExpert(shared);

      const response = await importRows([
        { sourceId: unmatched, classification: "unmatched" },
        { sourceId: ambiguous, classification: "ambiguous" },
        { sourceId: duplicate, classification: "duplicate" },
        { sourceId: removed, classification: "unmatched" },
      ]);

      expect(response.statusCode, response.payload).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        imported: 4,
        unmatched: 2,
        ambiguous: 1,
        duplicate: 1,
      });

      const page = await listQueue();
      const mine = page.data.filter((item) => item.eventId === eventId);
      expect(mine).toHaveLength(4);
      expect(
        new Map(mine.map((i) => [i.sourceId, i.originalClassification])),
      ).toEqual(
        new Map([
          [unmatched, "unmatched"],
          [ambiguous, "ambiguous"],
          [duplicate, "duplicate"],
          [removed, "unmatched"],
        ]),
      );
      expect(mine.every((i) => i.disposition === "unresolved")).toBe(true);
      for (const item of mine) {
        for (const forbidden of [
          "suggestedExpertId",
          "suggestedExpertName",
          "matchedExpertId",
          "candidates",
          "similarity",
        ]) {
          expect(item).not.toHaveProperty(forbidden);
        }
      }

      // Re-importing is refused: the queue is imported exactly once.
      const again = await importRows([
        { sourceId: unmatched, classification: "unmatched" },
        { sourceId: ambiguous, classification: "ambiguous" },
        { sourceId: duplicate, classification: "duplicate" },
        { sourceId: removed, classification: "unmatched" },
      ]);
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });
    });

    // ── Rows arriving during the review window ─────────────────────────────

    it("012 EARS-24.24: a source row inserted while review is open is enqueued atomically as unmatched and blocks closure until resolved", async () => {
      const eventId = await insertEvent();
      const seeded = await insertPreExpandSpeaker(eventId, 0, "Seeded Person");
      expect(
        (await importRows([{ sourceId: seeded, classification: "unmatched" }]))
          .statusCode,
      ).toBe(200);
      expect(
        (await resolve(seeded, { disposition: "content_removed" })).statusCode,
      ).toBe(200);
      expect((await recordRelease()).statusCode).toBe(200);

      // Insert-first interleaving: the row and its review commit together.
      const late = await insertLiveSpeaker(eventId, 1, "Late Arrival");
      const page = await listQueue();
      const lateItem = page.data.find((i) => i.sourceId === late);
      expect(lateItem).toMatchObject({
        originalClassification: "unmatched",
        disposition: "unresolved",
      });

      // Closure sees it and refuses — exact coverage includes rows that landed
      // after the import.
      const refused = await closeSource();
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });
      expect((await phaseRow()).phase).toBe("review_open");

      // Close-first interleaving: once resolved and closed, a further INSERT is
      // refused at the database boundary.
      expect(
        (await resolve(late, { disposition: "content_removed" })).statusCode,
      ).toBe(200);
      expect((await closeSource()).statusCode).toBe(200);
      await expect(
        pool.query(
          `INSERT INTO event_speakers (event_id, position, name, regalia)
           VALUES ($1, 2, 'Too Late', 'MD')`,
          [eventId],
        ),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
    });

    it("012 EARS-24.25: a reviewed source row refuses UPDATE and DELETE with SPEAKER_MIGRATION_SOURCE_IMMUTABLE", async () => {
      const eventId = await insertEvent();
      const sourceId = await insertPreExpandSpeaker(eventId, 0, "Ivanov Ivan");
      expect(
        (await importRows([{ sourceId, classification: "unmatched" }]))
          .statusCode,
      ).toBe(200);

      await expect(
        pool.query("UPDATE event_speakers SET name = $2 WHERE id = $1", [
          sourceId,
          "Rewritten",
        ]),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
      await expect(
        pool.query("DELETE FROM event_speakers WHERE id = $1", [sourceId]),
      ).rejects.toThrow(/retained provenance; DELETE refused/);
      // The review row's provenance is equally immutable.
      await expect(
        pool.query(
          `UPDATE speaker_migration_reviews
              SET original_classification = 'duplicate'
            WHERE source_speaker_id = $1`,
          [sourceId],
        ),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);
    });

    // ── Explicit resolutions ───────────────────────────────────────────────

    it("012 EARS-24.26: each disposition writes one canonical outcome with the operator's role and order, idempotently", async () => {
      const eventId = await insertEvent();
      const toExisting = await insertPreExpandSpeaker(eventId, 0, "Same Name");
      const toCreated = await insertPreExpandSpeaker(eventId, 1, "Legacy One");
      const toRemoved = await insertPreExpandSpeaker(eventId, 2, "Remove Me");
      const expertId = await insertEligibleExpert("Same Name");
      expect(
        (
          await importRows([
            { sourceId: toExisting, classification: "unmatched" },
            { sourceId: toCreated, classification: "ambiguous" },
            { sourceId: toRemoved, classification: "duplicate" },
          ])
        ).statusCode,
      ).toBe(200);

      const key = randomUUID();
      const payload = {
        disposition: "existing_expert",
        expertId,
        role: "speaker",
        position: 0,
      };
      const first = await resolve(toExisting, payload, key);
      const replay = await resolve(toExisting, payload, key);
      expect(first.statusCode, first.payload).toBe(200);
      expect(JSON.parse(replay.payload)).toEqual(JSON.parse(first.payload));

      const created = await resolve(toCreated, {
        disposition: "created_expert",
        expert: {
          familyName: "Imported",
          givenName: "Doctor",
          patronymic: "Ivanovich",
          professionalRole: "Cardiologist",
        },
        role: "moderator",
        position: 1,
      });
      expect(created.statusCode, created.payload).toBe(200);

      const removed = await resolve(toRemoved, {
        disposition: "content_removed",
      });
      expect(removed.statusCode, removed.payload).toBe(200);

      const items = [first, created, removed].map(
        (r) => JSON.parse(r.payload) as MigrationReviewItem,
      );
      expect(items.map((i) => i.disposition)).toEqual([
        "existing_expert",
        "created_expert",
        "content_removed",
      ]);
      expect(items[0]!.resolvedExpertId).toBe(expertId);
      expect(items[0]!.resolvedRole).toBe("speaker");
      expect(items[0]!.resolvedPosition).toBe(0);
      expect(items[1]!.resolvedRole).toBe("moderator");
      expect(items[1]!.resolvedPosition).toBe(1);
      expect(items[2]!.eventExpertId).toBeNull();
      expect(items[2]!.resolvedExpertId).toBeNull();

      const links = await pool.query<{
        legacy_speaker_id: string;
        expert_id: string;
        role: string;
        position: number;
      }>(
        `SELECT legacy_speaker_id, expert_id, role, position FROM event_experts
          WHERE legacy_speaker_id = ANY($1::uuid[]) ORDER BY position`,
        [[toExisting, toCreated, toRemoved]],
      );
      expect(links.rows).toEqual([
        {
          legacy_speaker_id: toExisting,
          expert_id: expertId,
          role: "speaker",
          position: 0,
        },
        {
          legacy_speaker_id: toCreated,
          expert_id: items[1]!.resolvedExpertId,
          role: "moderator",
          position: 1,
        },
      ]);

      // A second, different terminal resolution is refused: the decision is made
      // once and is auditable forever.
      const conflicting = await resolve(toExisting, {
        disposition: "content_removed",
      });
      expect(conflicting.statusCode).toBe(409);
      expect(JSON.parse(conflicting.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });
    });

    it("012 EARS-24.27: only a retained duplicate (event, expert) pair is refused — the same Expert on another event is admitted", async () => {
      const eventA = await insertEvent();
      const eventB = await insertEvent();
      const firstOnA = await insertPreExpandSpeaker(eventA, 0, "Shared One");
      const secondOnA = await insertPreExpandSpeaker(eventA, 1, "Shared Two");
      const onB = await insertPreExpandSpeaker(eventB, 0, "Shared Three");
      const expertId = await insertEligibleExpert("Shared One");
      expect(
        (
          await importRows([
            { sourceId: firstOnA, classification: "unmatched" },
            { sourceId: secondOnA, classification: "duplicate" },
            { sourceId: onB, classification: "unmatched" },
          ])
        ).statusCode,
      ).toBe(200);

      expect(
        (
          await resolve(firstOnA, {
            disposition: "existing_expert",
            expertId,
            role: "speaker",
            position: 0,
          })
        ).statusCode,
      ).toBe(200);

      const duplicatePair = await resolve(secondOnA, {
        disposition: "existing_expert",
        expertId,
        role: "speaker",
        position: 1,
      });
      expect(duplicatePair.statusCode).toBe(409);
      expect(JSON.parse(duplicatePair.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });

      const otherEvent = await resolve(onB, {
        disposition: "existing_expert",
        expertId,
        role: "speaker",
        position: 0,
      });
      expect(otherEvent.statusCode, otherEvent.payload).toBe(200);

      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM event_experts WHERE expert_id = $1`,
        [expertId],
      );
      expect(Number(rows[0]!.n)).toBe(2);
    });

    it("012 EARS-24.28: every resolution is audited with its original classification, reviewer and time", async () => {
      const eventId = await insertEvent();
      const sourceId = await insertPreExpandSpeaker(eventId, 0, "Audited One");
      expect(
        (await importRows([{ sourceId, classification: "ambiguous" }]))
          .statusCode,
      ).toBe(200);

      const resolved = await resolve(sourceId, {
        disposition: "created_expert",
        expert: { familyName: "Audited", givenName: "Person" },
        role: "speaker",
        position: 0,
      });
      expect(resolved.statusCode, resolved.payload).toBe(200);
      const item = JSON.parse(resolved.payload) as MigrationReviewItem;
      expect(item.reviewerId).toBeTruthy();
      expect(item.reviewedAt).toBeTruthy();

      const audit = await pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_ledger
          WHERE event_type = 'SpeakerMigrationReviewResolved'
            AND metadata->>'sourceSpeakerId' = $1`,
        [sourceId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.metadata).toMatchObject({
        sourceSpeakerId: sourceId,
        eventId,
        originalClassification: "ambiguous",
        disposition: "created_expert",
        reviewerId: item.reviewerId,
      });
    });

    // ── Guarded closure ────────────────────────────────────────────────────

    it("012 EARS-24.29: closure without a recorded phase-aware release is refused with PRECONDITION_REQUIRED", async () => {
      const eventId = await insertEvent();
      const sourceId = await insertPreExpandSpeaker(eventId, 0, "Resolved One");
      expect(
        (await importRows([{ sourceId, classification: "unmatched" }]))
          .statusCode,
      ).toBe(200);
      expect(
        (await resolve(sourceId, { disposition: "content_removed" }))
          .statusCode,
      ).toBe(200);

      const response = await closeSource();
      expect(response.statusCode).toBe(428);
      expect(JSON.parse(response.payload)).toMatchObject({
        errorCode: "PRECONDITION_REQUIRED",
      });
      const state = await phaseRow();
      expect(state.phase).toBe("review_open");
      expect(state.minimum_compatible_release_sha).toBeNull();
    });

    it("012 EARS-24.30: closure with any unresolved row is refused and leaves phase and floor untouched", async () => {
      const eventId = await insertEvent();
      const resolvedRow = await insertPreExpandSpeaker(eventId, 0, "Done One");
      const openRow = await insertPreExpandSpeaker(eventId, 1, "Open One");
      expect(
        (
          await importRows([
            { sourceId: resolvedRow, classification: "unmatched" },
            { sourceId: openRow, classification: "unmatched" },
          ])
        ).statusCode,
      ).toBe(200);
      expect(
        (await resolve(resolvedRow, { disposition: "content_removed" }))
          .statusCode,
      ).toBe(200);
      expect((await recordRelease()).statusCode).toBe(200);

      const response = await closeSource();
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.payload)).toMatchObject({
        errorCode: "RELATIONSHIP_CONFLICT",
      });
      const state = await phaseRow();
      expect(state.phase).toBe("review_open");
      expect(state.minimum_compatible_release_sha).toBeNull();

      // The legacy write seam is still open while the phase is `review_open`.
      const stillOpen = await insertLiveSpeaker(eventId, 2, "Still Writable");
      expect(stillOpen).toBeTruthy();
    });

    it("012 EARS-24.31: closure advances the phase and installs the rollback floor in one transaction, then closes every free-text speaker seam", async () => {
      const eventId = await insertEvent();
      const kept = await insertPreExpandSpeaker(eventId, 0, "Canonical Doctor");
      const dropped = await insertPreExpandSpeaker(eventId, 1, "Remove Legacy");
      const expertId = await insertEligibleExpert("Canonical Doctor");
      await pool.query("UPDATE events SET state = 'published' WHERE id = $1", [
        eventId,
      ]);
      expect(
        (
          await importRows([
            { sourceId: kept, classification: "unmatched" },
            { sourceId: dropped, classification: "duplicate" },
          ])
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await resolve(kept, {
            disposition: "existing_expert",
            expertId,
            role: "speaker",
            position: 0,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await resolve(dropped, { disposition: "content_removed" })).statusCode,
      ).toBe(200);
      expect((await recordRelease(SHA_EXPAND, 11)).statusCode).toBe(200);

      const response = await closeSource();
      expect(response.statusCode, response.payload).toBe(200);
      expect(JSON.parse(response.payload)).toMatchObject({
        phase: "source_closed",
        resolvedSources: 1,
        contentRemoved: 1,
        minimumCompatibleReleaseSha: SHA_EXPAND,
        minimumCompatibleReleaseOrdinal: 11,
      });
      const state = await phaseRow();
      expect(state.phase).toBe("source_closed");
      expect(state.minimum_compatible_release_sha).toBe(SHA_EXPAND);
      expect(state.minimum_compatible_release_ordinal).toBe(11);

      // Provenance retained in full…
      const retained = await pool.query<{ id: string }>(
        "SELECT id FROM event_speakers WHERE event_id = $1 ORDER BY position",
        [eventId],
      );
      expect(retained.rows.map((r) => r.id)).toEqual([kept, dropped]);

      // …reads serve canonical Experts only…
      const publicRead = await app.inject({
        method: "GET",
        url: `/v1/public/events/${eventId}/speakers`,
      });
      expect(publicRead.statusCode, publicRead.payload).toBe(200);
      expect(JSON.parse(publicRead.payload)).toEqual([
        expect.objectContaining({ source: "expert", expertId }),
      ]);

      // …and every free-text write is refused, at the API and at the database.
      const boundary = "----ds1607boundary";
      const createPayload = JSON.stringify({
        title: "Refused free-text speakers",
        school: "Doctor School",
        startsAtMsk: "2027-01-01T13:00",
        durationMin: 60,
        description: "x",
        speakers: [{ name: "Free Text", regalia: "MD" }],
        specialties: [],
      });
      const apiWrite = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "idempotency-key": randomUUID(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: [
          `--${boundary}`,
          'Content-Disposition: form-data; name="payload"',
          "",
          createPayload,
          `--${boundary}--`,
          "",
        ].join(CRLF),
      });
      expect(apiWrite.statusCode, apiWrite.payload).toBe(409);
      // The 007 admin-events surface answers `{ code, message }`, not 012's RFC
      // 7807 body — the stable code is shared, the envelope is that surface's.
      expect(JSON.parse(apiWrite.payload)).toMatchObject({
        code: "SPEAKER_MIGRATION_SOURCE_IMMUTABLE",
      });
      await expect(
        pool.query("UPDATE event_speakers SET name = name WHERE id = $1", [
          kept,
        ]),
      ).rejects.toThrow(/SPEAKER_MIGRATION_SOURCE_IMMUTABLE/);

      // Closure is one-way: a second attempt is refused, not replayed as a
      // fresh advance.
      const again = await closeSource();
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.payload)).toMatchObject({
        errorCode: "SPEAKER_MIGRATION_SOURCE_IMMUTABLE",
      });
    });
  },
);

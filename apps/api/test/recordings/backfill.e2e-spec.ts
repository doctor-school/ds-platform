import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  backfillDepsFrom,
  parseBackfillManifest,
  runRecordingsBackfill,
  type BackfillReport,
} from "../../src/recordings/recordings-backfill.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";

// 014 EARS-29 (#1892) - the platform-born recording backfill, over the REAL
// stack: the Nest graph, the ordinary 014 commands, Postgres.
//
// The suite is a DRIVER test, not a mechanism test. What it proves is that the
// backfill is nothing but a caller of AttachRecording + PublishRecording:
//
// 1. Every committed row carries the feature-010 audit attribution of the
//    operator who ran it (source = system:recordings-backfill), because outside
//    HTTP the 010 interceptor never runs and the driver opens the audit context
//    itself. A row captured as `db-direct` is a FAILURE here.
// 2. Every refusal leaves the event exactly as it was - state, live_at,
//    starts_at - and the run continues to the remaining rows.
// 3. The dry-run writes nothing at all: no recording row, no audit row.

const RUTUBE_REF = "0123456789abcdef0123456789abcdef";
const RUTUBE_REF_2 = "fedcba9876543210fedcba9876543210";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-29 platform-born recording backfill (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];
    // The Zitadel sub of the operator running the backfill; --actor is REQUIRED
    // by the CLI, so the suite always passes one.
    const actorSub = `backfill-operator-${randomUUID()}`;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query(
          `DELETE FROM audit_ledger WHERE metadata->'pk'->>'id' IN
             (SELECT id::text FROM event_recordings WHERE event_id = $1)`,
          [id],
        );
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      await pool.query("DELETE FROM idempotency_keys WHERE actor_id = $1", [
        actorSub,
      ]);
    });

    afterAll(async () => {
      await app.close();
    });

    /** One event; the slug is returned so a manifest row can address it either way. */
    async function insertEvent(
      opts: { state?: string; origin?: string; live?: boolean } = {},
    ): Promise<{ id: string; slug: string }> {
      const slug = `rec-1892-${randomUUID()}`;
      const state = opts.state ?? "ended";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state, origin, live_at)
         VALUES ($1, $2, $3, now() - interval '3 days', 90, $4, $5,
                 CASE WHEN $6::boolean THEN now() - interval '3 days' ELSE NULL END)
         RETURNING id`,
        [
          slug,
          "Мероприятие 1892",
          "Кардиология сегодня",
          state,
          opts.origin ?? "platform",
          opts.live ?? state === "ended",
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      return { id, slug };
    }

    function source(embedRef = RUTUBE_REF) {
      return { provider: "rutube", embed_ref: embedRef, duration_sec: 5400 };
    }

    async function run(
      manifest: unknown,
      opts: { dryRun?: boolean } = {},
    ): Promise<BackfillReport> {
      return runRecordingsBackfill(
        backfillDepsFrom(app),
        parseBackfillManifest(manifest),
        { actorSub, dryRun: opts.dryRun ?? false },
      );
    }

    async function recordings(eventId: string) {
      const { rows } = await pool.query<{
        id: string;
        kind: string;
        status: string;
        duration_sec: number | null;
        deleted_at: Date | null;
      }>(
        `SELECT id, kind, status, duration_sec, deleted_at
           FROM event_recordings WHERE event_id = $1`,
        [eventId],
      );
      return rows;
    }

    async function eventFacts(eventId: string) {
      const { rows } = await pool.query<{
        state: string;
        live_at: Date | null;
        starts_at: Date;
      }>("SELECT state, live_at, starts_at FROM events WHERE id = $1", [
        eventId,
      ]);
      return rows[0]!;
    }

    async function auditRows(recordingId: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
        source: string | null;
      }>(
        `SELECT event_type, subject_id, metadata->>'source' AS source
           FROM audit_ledger WHERE metadata->'pk'->>'id' = $1
           ORDER BY created_at`,
        [recordingId],
      );
      return rows;
    }

    it("014 EARS-29: when the operator runs the backfill over ended platform-born эфиры, the system shall attach and publish one recording per row through the ordinary commands, leaving every lifecycle field untouched", async () => {
      const first = await insertEvent();
      const second = await insertEvent();
      const before = await eventFacts(first.id);

      const report = await run([
        { event: first.id, edited: source() },
        // Addressed by SLUG - the manifest accepts either (design 3.2).
        { event: second.slug, edited: source(RUTUBE_REF_2) },
      ]);

      expect(report.entries.map((e) => e.outcome)).toEqual([
        "attached+published",
        "attached+published",
      ]);
      expect(report.summary["attached+published"]).toBe(2);

      for (const eventId of [first.id, second.id]) {
        const rows = await recordings(eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "edited",
          status: "published",
          duration_sec: 5400,
          deleted_at: null,
        });
      }

      // The event itself is never written by the backfill.
      const after = await eventFacts(first.id);
      expect(after.state).toBe("ended");
      expect(after.live_at?.toISOString()).toBe(before.live_at?.toISOString());
      expect(after.starts_at.toISOString()).toBe(
        before.starts_at.toISOString(),
      );

      // One feature-010 audit row per committed mutation (the insert and the
      // publish update), attributed to the operator and to the backfill door -
      // NEVER db-direct, which is what a context-less script write produces.
      const recordingId = (await recordings(first.id))[0]!.id;
      const audit = await auditRows(recordingId);
      expect(audit.map((r) => r.event_type)).toEqual([
        "data.event_recordings.insert",
        "data.event_recordings.update",
      ]);
      for (const row of audit) {
        expect(row.subject_id).toBe(actorSub);
        expect(row.source).toBe("system:recordings-backfill");
      }
    });

    it("014 EARS-29: when the very same manifest is re-run, the system shall report every row skipped and write neither a second recording nor an audit row", async () => {
      const event = await insertEvent();
      const manifest = [{ event: event.id, edited: source() }];
      await run(manifest);
      const recordingId = (await recordings(event.id))[0]!.id;
      const auditBefore = await auditRows(recordingId);

      const report = await run(manifest);

      expect(report.entries.map((e) => e.outcome)).toEqual(["skipped"]);
      expect(await recordings(event.id)).toHaveLength(1);
      expect(await auditRows(recordingId)).toHaveLength(auditBefore.length);
    });

    it("014 EARS-29: when a manifest row targets a published event whose date has passed, the system shall refuse it with EVENT_NOT_FINISHED, leave the event published and continue the run", async () => {
      const stale = await insertEvent({ state: "published", live: false });
      const eligible = await insertEvent();

      const report = await run([
        { event: stale.id, edited: source() },
        { event: eligible.id, edited: source(RUTUBE_REF_2) },
      ]);

      expect(report.entries[0]).toMatchObject({
        outcome: "refused",
        code: "EVENT_NOT_FINISHED",
      });
      expect(await recordings(stale.id)).toHaveLength(0);
      expect((await eventFacts(stale.id)).state).toBe("published");
      // The run continued past the refusal.
      expect(report.entries[1]!.outcome).toBe("attached+published");
    });

    it("014 EARS-29: when a manifest row targets a legacy event or an unknown id, the system shall refuse it with INVALID_TRANSITION per EARS-27 or the event read's own 404 and attach nothing", async () => {
      const legacy = await insertEvent({ state: "hidden", origin: "legacy" });
      const unknownSlug = `rec-1892-missing-${randomUUID()}`;

      const report = await run([
        { event: legacy.id, edited: source() },
        { event: unknownSlug, edited: source(RUTUBE_REF_2) },
      ]);

      expect(report.entries[0]).toMatchObject({
        outcome: "refused",
        code: "INVALID_TRANSITION",
      });
      expect(await recordings(legacy.id)).toHaveLength(0);
      // An unknown id or slug is the existing event read's own 404, reported.
      expect(report.entries[1]).toMatchObject({
        outcome: "refused",
        code: "RESOURCE_NOT_FOUND",
      });
    });

    it("014 EARS-29: when the backfill runs in dry-run, the system shall report would-attach, skipped and refused per row and mutate nothing", async () => {
      const fresh = await insertEvent();
      const done = await insertEvent();
      const stale = await insertEvent({ state: "published", live: false });
      await run([{ event: done.id, edited: source(RUTUBE_REF_2) }]);
      const doneRecordingId = (await recordings(done.id))[0]!.id;
      const auditBefore = await auditRows(doneRecordingId);

      const report = await run(
        [
          { event: fresh.id, edited: source() },
          { event: done.id, edited: source(RUTUBE_REF_2) },
          { event: stale.id, edited: source() },
        ],
        { dryRun: true },
      );

      expect(report.entries.map((e) => e.outcome)).toEqual([
        "would-attach",
        "skipped",
        "refused",
      ]);
      expect(report.entries[2]!.code).toBe("EVENT_NOT_FINISHED");
      // Nothing moved: no new row, no new audit row, no event field touched.
      expect(await recordings(fresh.id)).toHaveLength(0);
      expect(await recordings(done.id)).toHaveLength(1);
      expect(await auditRows(doneRecordingId)).toHaveLength(auditBefore.length);
      expect((await eventFacts(fresh.id)).state).toBe("ended");
    });

    it("014 EARS-29: when the kind already carries a non-retired draft, the system shall publish that row and never attach a second one", async () => {
      const event = await insertEvent();
      await run([{ event: event.id, edited: source() }]);
      const attachedId = (await recordings(event.id))[0]!.id;
      // Put the row back into draft so the next run meets exactly the design
      // 3.2 "a non-retired draft exists" condition.
      await pool.query(
        "UPDATE event_recordings SET status = 'draft' WHERE id = $1",
        [attachedId],
      );

      const report = await run([{ event: event.id, edited: source() }]);

      expect(report.entries[0]!.outcome).toBe("published");
      const rows = await recordings(event.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: attachedId, status: "published" });
    });
  },
);

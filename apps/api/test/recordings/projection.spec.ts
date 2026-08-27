import { randomUUID } from "node:crypto";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import type { RecordingProjection } from "@ds/schemas";
import {
  foldRecordingProjection,
  RecordingsProjectionService,
} from "../../src/recordings/recordings.projection.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";

// 014 EARS-3 (#1340) — ONE canonical edited-over-raw projection (014-design §4).
//
// The suite is in two halves on purpose.
//
// The FIRST half exercises the decision tree as a pure fold, with no database at
// all: all four input shapes, and the property that matters more than any single
// case — publishing the edited cut LATER promotes it with no operator edit, and
// unpublishing it demotes it again, because nothing about ordering is stored.
//
// The SECOND half runs the resolver against the real Postgres and asserts the
// two structural promises the rule depends on: the batch form resolves N events
// in ONE statement (no per-card N+1), and `event_recordings` carries no
// `is_primary` / `is_featured` / ordering column that a future reader could
// mistake for the source of truth.

const RUTUBE_REF = "0123456789abcdef0123456789abcdef";
const RUTUBE_REF_2 = "fedcba9876543210fedcba9876543210";

describe("014 EARS-3 edited-over-raw projection (fold)", () => {
  it("EARS-3: both kinds published ⇒ montage, primary edited, secondary raw", () => {
    expect(
      foldRecordingProjection(
        [
          { kind: "raw", posterRef: "raw-poster" },
          { kind: "edited", posterRef: "edited-poster" },
        ],
        "2026-09-01",
      ),
    ).toEqual({
      state: "montage",
      primaryKind: "edited",
      secondaryKind: "raw",
      // The primary cut's poster, not the raw one that happened to arrive first.
      posterUrl: "edited-poster",
      expectedBy: null,
    });
  });

  it("EARS-3: edited alone ⇒ montage with no secondary", () => {
    expect(
      foldRecordingProjection([{ kind: "edited", posterRef: null }], null),
    ).toEqual({
      state: "montage",
      primaryKind: "edited",
      secondaryKind: null,
      posterUrl: null,
      expectedBy: null,
    });
  });

  it("EARS-3: raw alone ⇒ raw-only, raw is the primary", () => {
    expect(
      foldRecordingProjection([{ kind: "raw", posterRef: "raw-poster" }], null),
    ).toEqual({
      state: "raw-only",
      primaryKind: "raw",
      secondaryKind: null,
      posterUrl: "raw-poster",
      expectedBy: null,
    });
  });

  it("EARS-3: nothing published ⇒ preparing, carrying the promised day", () => {
    expect(foldRecordingProjection([], "2026-09-01")).toEqual({
      state: "preparing",
      primaryKind: null,
      secondaryKind: null,
      posterUrl: null,
      expectedBy: "2026-09-01",
    });
  });

  it("EARS-3: publishing the edited cut later promotes it with no operator edit", () => {
    const raw = { kind: "raw" as const, posterRef: "raw-poster" };
    const edited = { kind: "edited" as const, posterRef: "edited-poster" };

    // Week one: only the raw capture is published.
    const before = foldRecordingProjection([raw], "2026-09-01");
    expect(before.state).toBe("raw-only");
    expect(before.primaryKind).toBe("raw");

    // Week three: the montage is published. Nothing else changed — no ordering
    // flag was set, no existing row was touched — and the montage now leads.
    const after = foldRecordingProjection([raw, edited], "2026-09-01");
    expect(after.primaryKind).toBe("edited");
    expect(after.secondaryKind).toBe("raw");

    // And the promotion is symmetrical: unpublishing the montage falls straight
    // back to the raw cut, which is only true because nothing was persisted.
    expect(foldRecordingProjection([raw], "2026-09-01")).toEqual(before);
  });
});

// Gated on `DATABASE_URL` ALONE, like the other 47 DB-backed suites. `IDP_ISSUER`
// must NOT appear here: `turbo.json` `tasks.test.passThroughEnv` does not forward
// it, so naming it would skip these cases on CI forever. Nothing below needs it —
// `IDP_CLIENT` is overridden with `FakeIdpClient` and the var is optional in
// `env.schema.ts`, so `AppModule` boots without it.
describe.skipIf(!process.env.DATABASE_URL)(
  "014 EARS-3 edited-over-raw projection (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let projection: RecordingsProjectionService;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];

    /** An `ended` event, optionally promising a readiness day. */
    async function insertEvent(
      expectedBy: string | null = null,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state, recording_expected_by)
         VALUES ($1, $2, $3, now() - interval '2 days', 90, 'ended', $4)
         RETURNING id`,
        [
          `rec-1340-${randomUUID()}`,
          "Мероприятие 1340",
          "Кардиология сегодня",
          expectedBy,
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      return id;
    }

    /**
     * A recording row inserted directly. The admin publish path is 014 EARS-2's
     * own suite; what EARS-3 reads is the resulting ROW STATE, so the fixture
     * states it rather than re-driving four HTTP commands per case.
     */
    async function insertRecording(
      eventId: string,
      kind: "edited" | "raw",
      opts: {
        status?: "draft" | "published" | "retired";
        posterRef?: string | null;
        embedRef?: string;
      } = {},
    ): Promise<void> {
      const status = opts.status ?? "published";
      await pool.query(
        `INSERT INTO event_recordings
           (event_id, kind, provider, embed_ref, poster_ref, status, first_published_at, deleted_at)
         VALUES ($1, $2, 'rutube', $3, $4, $5, $6, $7)`,
        [
          eventId,
          kind,
          opts.embedRef ?? (kind === "edited" ? RUTUBE_REF : RUTUBE_REF_2),
          opts.posterRef ?? null,
          status,
          status === "draft" ? null : new Date(),
          status === "retired" ? new Date() : null,
        ],
      );
    }

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
      projection = app.get(RecordingsProjectionService);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-3: resolves the four shapes off published non-retired rows alone", async () => {
      const both = await insertEvent();
      await insertRecording(both, "raw");
      await insertRecording(both, "edited", { posterRef: "edited-poster" });

      const editedOnly = await insertEvent();
      await insertRecording(editedOnly, "edited");

      const rawOnly = await insertEvent();
      await insertRecording(rawOnly, "raw", { posterRef: "raw-poster" });

      const none = await insertEvent("2026-09-15");

      expect(await projection.resolveRecordingProjection(both)).toEqual({
        state: "montage",
        primaryKind: "edited",
        secondaryKind: "raw",
        posterUrl: "edited-poster",
        expectedBy: null,
      });
      expect(
        await projection.resolveRecordingProjection(editedOnly),
      ).toMatchObject({ state: "montage", secondaryKind: null });
      expect(
        await projection.resolveRecordingProjection(rawOnly),
      ).toMatchObject({
        state: "raw-only",
        primaryKind: "raw",
        posterUrl: "raw-poster",
      });
      expect(await projection.resolveRecordingProjection(none)).toEqual({
        state: "preparing",
        primaryKind: null,
        secondaryKind: null,
        posterUrl: null,
        expectedBy: "2026-09-15",
      });
    });

    it("EARS-3: a draft or retired row is indistinguishable from none", async () => {
      const drafted = await insertEvent("2026-10-01");
      await insertRecording(drafted, "edited", { status: "draft" });

      const retired = await insertEvent("2026-10-02");
      await insertRecording(retired, "edited", { status: "retired" });

      // A retired EDITED cut leaves a published raw one leading — that is the
      // demotion path, and it needs no write anywhere.
      const demoted = await insertEvent();
      await insertRecording(demoted, "edited", { status: "retired" });
      await insertRecording(demoted, "raw");

      expect(
        await projection.resolveRecordingProjection(drafted),
      ).toMatchObject({ state: "preparing", expectedBy: "2026-10-01" });
      expect(
        await projection.resolveRecordingProjection(retired),
      ).toMatchObject({ state: "preparing", expectedBy: "2026-10-02" });
      expect(
        await projection.resolveRecordingProjection(demoted),
      ).toMatchObject({ state: "raw-only", primaryKind: "raw" });
    });

    it("EARS-3: the batch form resolves N events in ONE statement (no N+1)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = await insertEvent(i === 4 ? "2026-11-01" : null);
        if (i < 2) await insertRecording(id, "edited");
        else if (i < 4) await insertRecording(id, "raw");
        ids.push(id);
      }

      // Count the statements the resolver actually issues. A per-card read would
      // show 5 here; the LEFT JOIN shows 1, whatever the page size.
      //
      // This counts only because `projectionRowsByEvents` runs OFF THE POOL:
      // drizzle's non-transactional session dispatches through `pool.query`, the
      // very method patched below. Move that read inside `repository.transaction()`
      // and drizzle takes a dedicated client via `pool.connect()` — the counter
      // would read 0 and this assertion would pass while asserting nothing.
      const original = pool.query.bind(pool);
      let statements = 0;
      (pool as unknown as { query: typeof pool.query }).query = ((
        ...args: unknown[]
      ) => {
        statements += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      }) as typeof pool.query;

      let resolved: Map<string, RecordingProjection>;
      try {
        resolved = await projection.resolveRecordingProjections(ids);
      } finally {
        (pool as unknown as { query: typeof pool.query }).query = original;
      }

      expect(statements).toBe(1);
      // Every requested id is present — a consumer never distinguishes a missing
      // key from «no recording».
      expect([...resolved.keys()].sort()).toEqual([...ids].sort());
      expect(resolved.get(ids[0]!)!.state).toBe("montage");
      expect(resolved.get(ids[2]!)!.state).toBe("raw-only");
      expect(resolved.get(ids[4]!)!.state).toBe("preparing");
    });

    it("EARS-3: event_recordings carries no stored ordering column", async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'event_recordings'`,
      );
      const columns = rows.map((r) => r.column_name);
      for (const banned of [
        "is_primary",
        "is_featured",
        "primary",
        "featured",
        "display_order",
        "sort_order",
        "position",
        "rank",
      ]) {
        expect(columns).not.toContain(banned);
      }
    });
  },
);

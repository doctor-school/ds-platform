import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";
import { deleteExpertFixtures } from "../setup/speaker-fixtures.js";

// 014 EARS-21 (#1608) — the ARCHIVED event's speaker block, over the real stack.
//
// The live/upcoming projection is already pinned by `speaker-projection.e2e-spec.ts`
// (012 EARS-8). What that suite does NOT say is what an event looks like once it
// has ENDED and its recording is published: the post-live page is the surface
// that used to carry the free-text speaker list, and it is the one place where a
// «fall back to the legacy names when the relation is empty» rule would have been
// tempting to keep. 014-design §L356 forbids exactly that — the archived page
// reads the canonical `event_experts` relation and nothing else, with no name
// matching and no fallback list.
//
// So this suite fixes THREE facts about `state = 'ended'` + a published recording:
//
//   21.1 ORDER + SHAPE — `PublicEventPage.speakers` and the standalone
//        `GET /v1/public/events/:key/speakers` are the same ordered resolver
//        result (`position ASC`, then link id ASC), in the 012-design §L310 item
//        shape, for an archived event;
//   21.2 ELIGIBILITY — a draft expert, a retired expert and a retired link
//        contribute nothing to an archived page, and an archived event with no
//        links is an honest `speakers: []` rather than a name-inferred list;
//   21.3 NO LEGACY SOURCE — statically, no surface on the archived path even
//        mentions a legacy speaker source, and the dropped table is really gone
//        from the database under test.
//
// Fixtures are raw SQL for the same reason the sibling suite gives: the admin
// writer refuses states this READ still has to be deterministic about.
//
// Skips when the stand is absent, exactly as the sibling public suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-21 archived-event speaker projection (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];

    // ── Fixtures ───────────────────────────────────────────────────────────

    /**
     * One ARCHIVED event: a platform-origin event that has already ENDED and
     * carries a published recording — the 014 post-live end state, seeded
     * directly as `my-events.e2e-spec.ts` does.
     */
    async function insertArchivedEvent(): Promise<{ id: string; slug: string }> {
      const slug = `a-1608-${randomUUID()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events
           (slug, title, school, starts_at, duration_min, description,
            specialties, state, origin)
         VALUES ($1, $2, $3, now() - interval '14 days', 90, $4,
                 $5, 'ended', 'platform')
         RETURNING id`,
        [
          slug,
          "Архивный эфир 1608",
          "Школа кардиологии",
          "Разбор клинических рекомендаций.",
          ["cardiology"],
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      await pool.query(
        `INSERT INTO event_recordings
           (event_id, kind, provider, embed_ref, status, first_published_at)
         VALUES ($1, 'edited', 'rutube', $2, 'published', now())`,
        [id, randomUUID().replace(/-/g, "").slice(0, 32)],
      );
      return { id, slug };
    }

    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row: Record<string, unknown> = {
        slug: `x-1608-${randomUUID()}`,
        family_name: "Иванова",
        given_name: "И. И.",
        credentials: "д.м.н., профессор",
        professional_role: "Кардиолог",
        status: "published",
        first_published_at: new Date(),
        ...overrides,
      };
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdExpertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertLink(values: {
      eventId: string;
      expertId: string;
      position: number;
      role?: string;
      status?: "active" | "retired";
    }): Promise<string> {
      const retired = values.status === "retired";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_experts
           (event_id, expert_id, role, position, status, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          values.eventId,
          values.expertId,
          values.role ?? "Спикер",
          values.position,
          values.status ?? "active",
          retired ? new Date() : null,
        ],
      );
      return rows[0]!.id;
    }

    // ── Request helpers ────────────────────────────────────────────────────

    interface SpeakerItem {
      source: "expert";
      expertId: string;
      expertSlug: string;
      name: string;
      credentials: string;
      photoUrl: string | null;
      role: string;
    }

    async function speakersEndpoint(key: string): Promise<SpeakerItem[]> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${key}/speakers`,
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload) as SpeakerItem[];
    }

    async function pageSpeakers(key: string): Promise<SpeakerItem[]> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${key}`,
      });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.payload) as { speakers: SpeakerItem[] }).speakers;
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
    });

    afterEach(async () => {
      // Children first — every FK into a retained aggregate is RESTRICT.
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      const expertIds = createdExpertIds.splice(0);
      for (const id of expertIds)
        await pool.query("DELETE FROM event_experts WHERE expert_id = $1", [id]);
      await deleteExpertFixtures(pool, expertIds);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("014 EARS-21.1: when an archived event's page is read, the system shall project its eligible event_experts links in relation order, identically on the page and the standalone endpoint", async () => {
      const event = await insertArchivedEvent();
      // Insert the SECOND slot first: a suite that seeds in display order can
      // pass while the resolver orders by insertion.
      const second = await insertExpert({
        family_name: "Второй",
        given_name: "В. В.",
        credentials: "к.м.н.",
        slug: `x-1608-second-${randomUUID()}`,
      });
      const first = await insertExpert({
        family_name: "Первая",
        given_name: "П. П.",
        credentials: "д.м.н., профессор",
        slug: `x-1608-first-${randomUUID()}`,
      });
      await insertLink({
        eventId: event.id,
        expertId: second,
        position: 2,
        role: "Модератор",
      });
      await insertLink({ eventId: event.id, expertId: first, position: 1 });

      const page = await pageSpeakers(event.slug);
      expect(page).toHaveLength(2);
      expect(page.map((s) => s.expertId)).toEqual([first, second]);
      expect(page[0]).toMatchObject({
        source: "expert",
        expertId: first,
        name: "Первая П. П.",
        credentials: "д.м.н., профессор",
        role: "Спикер",
      });
      expect(page[0]!.expertSlug).toMatch(/^x-1608-first-/);
      expect(page[0]!.photoUrl).toBeNull();
      expect(page[1]).toMatchObject({
        expertId: second,
        name: "Второй В. В.",
        credentials: "к.м.н.",
        role: "Модератор",
      });

      // The two shipped renderings of the one resolver result cannot disagree,
      // and addressing by id rather than slug changes nothing.
      expect(await speakersEndpoint(event.slug)).toEqual(page);
      expect(await speakersEndpoint(event.id)).toEqual(page);
      expect(await pageSpeakers(event.id)).toEqual(page);
    });

    it("014 EARS-21.2: when an archived event's only links point at ineligible experts or are retired, the system shall project an empty speaker list rather than infer names", async () => {
      const event = await insertArchivedEvent();
      const draft = await insertExpert({
        family_name: "Черновиков",
        status: "draft",
        first_published_at: null,
      });
      const retiredExpert = await insertExpert({
        family_name: "Отставной",
        status: "retired",
        // `experts_retired_iff_deleted` — a retired expert IS a soft-deleted one.
        deleted_at: new Date(),
      });
      const retiredLinkExpert = await insertExpert({
        family_name: "Отвязанный",
      });
      await insertLink({ eventId: event.id, expertId: draft, position: 1 });
      await insertLink({
        eventId: event.id,
        expertId: retiredExpert,
        position: 2,
      });
      await insertLink({
        eventId: event.id,
        expertId: retiredLinkExpert,
        position: 3,
        status: "retired",
      });

      expect(await pageSpeakers(event.slug)).toEqual([]);
      expect(await speakersEndpoint(event.slug)).toEqual([]);

      // …and an archived event that never had a link is the same honest empty
      // list — the published recording carries no speaker names of its own.
      const bare = await insertArchivedEvent();
      expect(await pageSpeakers(bare.slug)).toEqual([]);
      expect(await speakersEndpoint(bare.slug)).toEqual([]);
    });

    it("014 EARS-21.3: when the archived-page speaker path is inspected, the system shall carry no legacy speaker source in code or in the schema", async () => {
      const repoRoot = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "..",
      );
      const surfaces = [
        "apps/api/src/taxonomy/speaker-projection.service.ts",
        "apps/api/src/taxonomy/speaker-projection.repository.ts",
        "apps/api/src/events/events.service.ts",
        "apps/portal/app/webinars/[slug]/page.tsx",
        "packages/design-system/src/blocks/event-page-view.ts",
      ];
      // The tokens a fallback would HAVE to name: the dropped table, a legacy
      // row alias, or a free-text speaker column read.
      const forbidden = [
        "event_speakers",
        "legacy_speaker",
        "legacySpeaker",
        "speakers_text",
        "speaker_names",
      ];
      for (const relative of surfaces) {
        const source = readFileSync(join(repoRoot, relative), "utf8");
        for (const token of forbidden)
          expect(
            source.includes(token),
            `${relative} must not reference the legacy speaker source \`${token}\``,
          ).toBe(false);
      }

      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'event_speakers'`,
      );
      expect(rows).toEqual([]);
    });
  },
);

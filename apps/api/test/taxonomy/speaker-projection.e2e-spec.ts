import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 012 EARS-8 (#1290) — the ONE canonical merged speaker projection over the
// REAL stack: Fastify + Postgres, zero auth (every route under test is a
// classified public read).
//
// The invariant this suite defends is not «the endpoint returns speakers». It
// is that THREE shipped public surfaces — `GET /v1/public/events/:key/speakers`,
// `PublicEventPage.speakers` and the thinner `UpcomingBroadcastCard.speakers` —
// are three renderings of ONE ordered resolver result and therefore cannot
// disagree, plus the merge policy itself:
//
//   1. suppression is EXPLICIT-MATCH only. An eligible (published,
//      non-retired) expert linked through an ACTIVE `event_experts` row
//      supersedes exactly the legacy row its `legacy_speaker_id` names. Names
//      are never compared, so an identically-named unmatched legacy row stays;
//   2. a draft/retired expert, or a retired link, suppresses NOTHING — the
//      matched legacy row remains visible as the fallback. Restoring the link
//      suppresses the same stable legacy row again;
//   3. the total order is LD-2's: `position ASC`, source rank (`expert` before
//      `legacy`), stable row id ASC — deterministic even for the corrupted
//      cross-table position collision the write path refuses but imported data
//      can still carry.
//
// Fixtures are inserted with raw SQL on purpose. The admin write path already
// refuses a colliding slot (EARS-7, #1289); this suite has to prove the READ is
// deterministic anyway, which means constructing states the writer forbids.
//
// Skips when the stand is absent, exactly as the sibling public suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-8 merged public speaker projection (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];

    // ── Fixtures ───────────────────────────────────────────────────────────

    async function insertEvent(
      state: "draft" | "published" = "published",
      startsAt = "now() + interval '7 days'",
    ): Promise<{ id: string; slug: string }> {
      const slug = `e-1290-${randomUUID()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, $2, $3, ${startsAt}, 60, $4) RETURNING id`,
        [slug, "Эфир 1290", "Школа 1290", state],
      );
      createdEventIds.push(rows[0]!.id);
      return { id: rows[0]!.id, slug };
    }

    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row: Record<string, unknown> = {
        slug: `x-1290-${randomUUID()}`,
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

    async function insertSpeaker(
      eventId: string,
      position: number,
      name = "Петров П. П.",
      regalia = "к.м.н.",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_speakers (event_id, position, name, regalia)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [eventId, position, name, regalia],
      );
      return rows[0]!.id;
    }

    async function insertLink(values: {
      eventId: string;
      expertId: string;
      position: number;
      role?: string;
      legacySpeakerId?: string | null;
      status?: "active" | "retired";
    }): Promise<string> {
      const retired = values.status === "retired";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_experts
           (event_id, expert_id, role, position, legacy_speaker_id, status, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          values.eventId,
          values.expertId,
          values.role ?? "Спикер",
          values.position,
          values.legacySpeakerId ?? null,
          values.status ?? "active",
          retired ? new Date() : null,
        ],
      );
      return rows[0]!.id;
    }

    // ── Request helpers ────────────────────────────────────────────────────

    interface LegacyItem {
      source: "legacy";
      name: string;
      credentials: string;
    }
    interface ExpertItem {
      source: "expert";
      expertId: string;
      expertSlug: string;
      name: string;
      credentials: string;
      photoUrl: string | null;
      role: string;
    }
    type SpeakerItem = LegacyItem | ExpertItem;

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

    async function cardSpeakers(
      eventId: string,
    ): Promise<{ name: string }[] | undefined> {
      const res = await app.inject({ method: "GET", url: "/v1/public/events" });
      expect(res.statusCode).toBe(200);
      const cards = JSON.parse(res.payload) as {
        id: string;
        speakers: { name: string }[];
      }[];
      return cards.find((c) => c.id === eventId)?.speakers;
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
      // Children first — every FK is RESTRICT by design.
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM event_speakers WHERE event_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdExpertIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE expert_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-8.1: an eligible linked expert supersedes ONLY its explicitly matched legacy row", async () => {
      const event = await insertEvent();
      const matched = await insertSpeaker(event.id, 0, "Матчед М. М.");
      // Same name, no link — names are never compared, so it must survive.
      await insertSpeaker(event.id, 1, "Матчед М. М.");
      const expertId = await insertExpert({
        family_name: "Эксперт",
        given_name: "Э. Э.",
      });
      await insertLink({
        eventId: event.id,
        expertId,
        position: 0,
        legacySpeakerId: matched,
      });

      const items = await speakersEndpoint(event.slug);

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        source: "expert",
        expertId,
        name: "Эксперт Э. Э.",
        role: "Спикер",
      });
      expect(items[1]).toEqual({
        source: "legacy",
        name: "Матчед М. М.",
        credentials: "к.м.н.",
      });
    });

    it("EARS-8.2: an unpaired eligible expert is added; an ineligible expert contributes nothing", async () => {
      const event = await insertEvent();
      await insertSpeaker(event.id, 1, "Легаси Л. Л.");
      const publishedId = await insertExpert({
        family_name: "Опубликован",
        given_name: "О. О.",
      });
      const draftId = await insertExpert({
        family_name: "Черновик",
        given_name: "Ч. Ч.",
        status: "draft",
        first_published_at: null,
      });
      const retiredId = await insertExpert({
        family_name: "Снят",
        given_name: "С. С.",
        status: "retired",
        deleted_at: new Date(),
      });
      await insertLink({ eventId: event.id, expertId: publishedId, position: 0 });
      await insertLink({ eventId: event.id, expertId: draftId, position: 2 });
      await insertLink({ eventId: event.id, expertId: retiredId, position: 3 });

      const items = await speakersEndpoint(event.slug);

      expect(items.map((s) => s.name)).toEqual([
        "Опубликован О. О.",
        "Легаси Л. Л.",
      ]);
    });

    it("EARS-8.3: a draft/retired expert cannot suppress the fallback, and retiring the link reveals it again", async () => {
      const event = await insertEvent();
      const fallback = await insertSpeaker(event.id, 0, "Запасной З. З.");
      const draftId = await insertExpert({
        family_name: "Черновик",
        given_name: "Ч. Ч.",
        status: "draft",
        first_published_at: null,
      });
      await insertLink({
        eventId: event.id,
        expertId: draftId,
        position: 0,
        legacySpeakerId: fallback,
      });

      expect((await speakersEndpoint(event.slug)).map((s) => s.name)).toEqual([
        "Запасной З. З.",
      ]);

      // Publishing the expert suppresses the SAME stable legacy row…
      await pool.query(
        "UPDATE experts SET status = 'published', first_published_at = now() WHERE id = $1",
        [draftId],
      );
      expect((await speakersEndpoint(event.slug)).map((s) => s.name)).toEqual([
        "Черновик Ч. Ч.",
      ]);

      // …and retiring the LINK makes that same row visible again, untouched.
      await pool.query(
        "UPDATE event_experts SET status = 'retired', deleted_at = now() WHERE event_id = $1",
        [event.id],
      );
      expect((await speakersEndpoint(event.slug)).map((s) => s.name)).toEqual([
        "Запасной З. З.",
      ]);

      // Ordinary matching never rewrote the legacy row (EARS-8: no overwrite,
      // no retire, no name-dedup).
      const { rows } = await pool.query<{
        name: string;
        regalia: string;
        record_status: string;
      }>(
        "SELECT name, regalia, record_status FROM event_speakers WHERE id = $1",
        [fallback],
      );
      expect(rows[0]).toEqual({
        name: "Запасной З. З.",
        regalia: "к.м.н.",
        record_status: "active",
      });
    });

    it("EARS-8.4: the order is position ASC, and an expert outranks a legacy row on the SAME position", async () => {
      const event = await insertEvent();
      await insertSpeaker(event.id, 2, "Легаси Второй");
      // The CROSS-table position collision: no index can express it, the writer
      // refuses it (EARS-7) and imported data can still carry it — so the READ
      // must stay deterministic. Source rank puts the expert first.
      await insertSpeaker(event.id, 0, "Легаси Первый");
      const expertId = await insertExpert({
        family_name: "Эксперт",
        given_name: "A",
      });
      await insertLink({ eventId: event.id, expertId, position: 0 });

      const items = await speakersEndpoint(event.slug);

      expect(items.map((s) => s.name)).toEqual([
        "Эксперт A",
        "Легаси Первый",
        "Легаси Второй",
      ]);
      // The WITHIN-table half of the same rule is a database backstop, not a
      // policy this read can be asked to arbitrate: both partial unique indexes
      // (`event_experts_event_position_active_uniq`,
      // `event_speakers_event_position_active_uniq`) make two active rows of the
      // SAME source on one position unrepresentable. The stable-id term of the
      // LD-2 order is therefore exercised in the unit suite
      // (`src/taxonomy/speaker-projection.service.spec.ts`), where the resolver
      // can be handed the corrupted pair Postgres refuses to store.
    });

    it("EARS-8.5: the item is a STRICT union — no expert-only key on a legacy item, nullable-present photoUrl", async () => {
      const event = await insertEvent();
      await insertSpeaker(event.id, 1);
      const expertId = await insertExpert();
      await insertLink({
        eventId: event.id,
        expertId,
        position: 0,
        role: "Модератор",
      });

      const [expert, legacy] = await speakersEndpoint(event.slug);

      expect(Object.keys(legacy!).sort()).toEqual([
        "credentials",
        "name",
        "source",
      ]);
      expect(Object.keys(expert!).sort()).toEqual([
        "credentials",
        "expertId",
        "expertSlug",
        "name",
        "photoUrl",
        "role",
        "source",
      ]);
      // Present and null (the initials fallback), never absent.
      expect((expert as ExpertItem).photoUrl).toBeNull();
      expect((expert as ExpertItem).role).toBe("Модератор");
    });

    it("EARS-8.6: the standalone endpoint, the event page and the upcoming card agree", async () => {
      const event = await insertEvent();
      const matched = await insertSpeaker(event.id, 0, "Матчед М. М.");
      await insertSpeaker(event.id, 1, "Легаси Л. Л.");
      const expertId = await insertExpert({
        family_name: "Эксперт",
        given_name: "Э. Э.",
      });
      await insertLink({
        eventId: event.id,
        expertId,
        position: 0,
        legacySpeakerId: matched,
      });

      const endpoint = await speakersEndpoint(event.slug);
      const page = await pageSpeakers(event.slug);
      const card = await cardSpeakers(event.id);

      expect(page).toEqual(endpoint);
      // The card is the SAME ordered result, mapped to its thinner `{ name }`.
      expect(card).toEqual(endpoint.map((s) => ({ name: s.name })));
    });

    it("EARS-8.7: an id key resolves the same projection as its slug key", async () => {
      const event = await insertEvent();
      await insertSpeaker(event.id, 0, "Легаси Л. Л.");

      expect(await speakersEndpoint(event.id)).toEqual(
        await speakersEndpoint(event.slug),
      );
    });

    it("EARS-8.8/16: an unknown or non-public event is an indistinguishable 404 RESOURCE_NOT_FOUND", async () => {
      const draft = await insertEvent("draft");
      await insertSpeaker(draft.id, 0, "Скрытый С. С.");

      for (const key of [draft.slug, draft.id, randomUUID(), "no-such-event"]) {
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/events/${key}/speakers`,
        });
        expect(res.statusCode).toBe(404);
        expect(res.headers["content-type"]).toContain("application/problem");
        const problem = JSON.parse(res.payload) as {
          errorCode: string;
          traceId?: string;
        };
        expect(problem.errorCode).toBe("RESOURCE_NOT_FOUND");
        expect(problem.traceId).toBeTruthy();
      }
    });

    it("EARS-8.9: an eligible event with no speakers at all is a valid empty projection", async () => {
      const event = await insertEvent();

      expect(await speakersEndpoint(event.slug)).toEqual([]);
      expect(await pageSpeakers(event.slug)).toEqual([]);
    });
  },
);

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

// 012 EARS-8 (#1290) — the ONE canonical public speaker projection over the
// REAL stack: Fastify + Postgres, zero auth (every route under test is a
// classified public read).
//
// The invariant this suite defends is not «the endpoint returns speakers». It
// is that THREE shipped public surfaces — `GET /v1/public/events/:key/speakers`,
// `PublicEventPage.speakers` and the thinner `UpcomingBroadcastCard.speakers` —
// are three renderings of ONE ordered resolver result and therefore cannot
// disagree, plus the projection policy itself:
//
//   1. after the EARS-24 cutover (#1607) the projection has ONE source, the
//      `event_experts` link table. There is no second list to merge, no match
//      to express and no suppression rule to arbitrate;
//   2. eligibility is re-evaluated on every READ: an ACTIVE link to a
//      published, non-retired expert contributes an item; a draft or retired
//      expert, or a retired link, contributes nothing — and publishing or
//      restoring puts the item back without a write to the link;
//   3. the total order is LD-2's: `position ASC`, then stable link id ASC.
//
// Fixtures are inserted with raw SQL on purpose. The admin write path already
// refuses a colliding slot (EARS-7, #1289); this suite has to prove the READ is
// deterministic anyway, which means constructing states the writer forbids.
//
// Skips when the stand is absent, exactly as the sibling public suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-8 public speaker projection (e2e)",
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

    it("EARS-8.1: every ACTIVE link to an eligible expert appears exactly once, in slot order", async () => {
      const event = await insertEvent();
      const second = await insertExpert({
        family_name: "Второй",
        given_name: "В. В.",
      });
      const first = await insertExpert({
        family_name: "Первый",
        given_name: "П. П.",
      });
      await insertLink({ eventId: event.id, expertId: second, position: 1 });
      await insertLink({ eventId: event.id, expertId: first, position: 0 });

      const items = await speakersEndpoint(event.slug);

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        source: "expert",
        expertId: first,
        name: "Первый П. П.",
        role: "Спикер",
      });
      expect(items[1]).toMatchObject({ expertId: second });
    });

    it("EARS-8.2: an eligible expert is added; an ineligible expert contributes nothing", async () => {
      const event = await insertEvent();
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

      expect(items.map((s) => s.name)).toEqual(["Опубликован О. О."]);
    });

    it("EARS-8.3: eligibility is re-read on every request — publishing adds the item, retiring the link removes it, and neither writes the link", async () => {
      const event = await insertEvent();
      const draftId = await insertExpert({
        family_name: "Черновик",
        given_name: "Ч. Ч.",
        status: "draft",
        first_published_at: null,
      });
      const linkId = await insertLink({
        eventId: event.id,
        expertId: draftId,
        position: 0,
      });

      // A draft expert is invisible even though the link is active.
      expect(await speakersEndpoint(event.slug)).toEqual([]);

      // Publishing the expert reveals it — no write touched the link…
      await pool.query(
        "UPDATE experts SET status = 'published', first_published_at = now() WHERE id = $1",
        [draftId],
      );
      expect((await speakersEndpoint(event.slug)).map((s) => s.name)).toEqual([
        "Черновик Ч. Ч.",
      ]);

      // …and retiring the LINK hides it again while the expert stays published.
      await pool.query(
        "UPDATE event_experts SET status = 'retired', deleted_at = now() WHERE id = $1",
        [linkId],
      );
      expect(await speakersEndpoint(event.slug)).toEqual([]);

      const { rows } = await pool.query<{ status: string; position: number }>(
        "SELECT status, position FROM event_experts WHERE id = $1",
        [linkId],
      );
      expect(rows[0]).toEqual({ status: "retired", position: 0 });
    });

    it("EARS-8.4: the order is position ASC and sparse slots do not reorder the list", async () => {
      const event = await insertEvent();
      const third = await insertExpert({ family_name: "Третий", given_name: "A" });
      const first = await insertExpert({ family_name: "Первый", given_name: "A" });
      const second = await insertExpert({
        family_name: "Второй",
        given_name: "A",
      });
      await insertLink({ eventId: event.id, expertId: third, position: 9 });
      await insertLink({ eventId: event.id, expertId: first, position: 0 });
      await insertLink({ eventId: event.id, expertId: second, position: 4 });

      const items = await speakersEndpoint(event.slug);

      expect(items.map((s) => s.name)).toEqual([
        "Первый A",
        "Второй A",
        "Третий A",
      ]);
      // The tie-breaking half of the LD-2 order is a database backstop, not a
      // policy this read can be asked to arbitrate: the partial unique index
      // `event_experts_event_position_active_uniq` makes two ACTIVE links on one
      // position unrepresentable. The stable-id term is therefore exercised in
      // the unit suite (`src/taxonomy/speaker-projection.service.spec.ts`),
      // where the resolver can be handed the corrupted pair Postgres refuses.
    });

    it("EARS-8.5: the item carries exactly the expert-arm key set, with photoUrl present and null", async () => {
      const event = await insertEvent();
      const expertId = await insertExpert();
      await insertLink({
        eventId: event.id,
        expertId,
        position: 0,
        role: "Модератор",
      });

      const [expert] = await speakersEndpoint(event.slug);

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
      expect(expert!.photoUrl).toBeNull();
      expect(expert!.role).toBe("Модератор");
    });

    it("EARS-8.6: the standalone endpoint, the event page and the upcoming card agree", async () => {
      const event = await insertEvent();
      const expertId = await insertExpert({
        family_name: "Эксперт",
        given_name: "Э. Э.",
      });
      const otherId = await insertExpert({
        family_name: "Другой",
        given_name: "Д. Д.",
      });
      await insertLink({ eventId: event.id, expertId, position: 0 });
      await insertLink({ eventId: event.id, expertId: otherId, position: 1 });

      const endpoint = await speakersEndpoint(event.slug);
      const page = await pageSpeakers(event.slug);
      const card = await cardSpeakers(event.id);

      expect(endpoint).toHaveLength(2);
      expect(page).toEqual(endpoint);
      // The card is the SAME ordered result, mapped to its thinner `{ name }`.
      expect(card).toEqual(endpoint.map((s) => ({ name: s.name })));
    });

    it("EARS-8.7: an id key resolves the same projection as its slug key", async () => {
      const event = await insertEvent();
      const expertId = await insertExpert();
      await insertLink({ eventId: event.id, expertId, position: 0 });

      expect(await speakersEndpoint(event.id)).toEqual(
        await speakersEndpoint(event.slug),
      );
    });

    it("EARS-8.8/16: an unknown or non-public event is an indistinguishable 404 RESOURCE_NOT_FOUND", async () => {
      const draft = await insertEvent("draft");
      const expertId = await insertExpert({
        family_name: "Скрытый",
        given_name: "С. С.",
      });
      await insertLink({ eventId: draft.id, expertId, position: 0 });

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

    it("012 EARS-24: the canonical resolver reads links only, and no migration-phase SSOT survives to consult", async () => {
      const event = await insertEvent();
      const second = await insertExpert({
        family_name: "Второй",
        given_name: "В. В.",
      });
      const first = await insertExpert({
        family_name: "Первый",
        given_name: "П. П.",
      });
      await insertLink({ eventId: event.id, expertId: second, position: 2 });
      await insertLink({ eventId: event.id, expertId: first, position: 1 });

      const projection = await speakersEndpoint(event.slug);

      expect(projection.map((s) => s.name)).toEqual([
        "Первый П. П.",
        "Второй В. В.",
      ]);
      expect(projection.every((s) => s.source === "expert")).toBe(true);
      // The three shipped surfaces stay one result.
      expect(await pageSpeakers(event.slug)).toEqual(projection);
      expect(await cardSpeakers(event.id)).toEqual(
        projection.map((s) => ({ name: s.name })),
      );

      // No phase is consulted because no phase SSOT exists any more.
      const { rows } = await pool.query<{ n: string | null }>(
        `SELECT to_regclass('public.speaker_migration_cutover') AS n`,
      );
      expect(rows[0]!.n).toBeNull();
    });
  },
);

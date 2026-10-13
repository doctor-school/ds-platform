import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  addDoctorEventsFeedDays,
  DoctorEventsFeedSchema,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { EVENT_HORIZON_ROW_CAP } from "../../src/events/event-horizon.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 019 EARS-3 (#1518) — the day-grouped, specialty-targeted feed over REAL rows.
 *
 * The fixture is built to make an accidental likeness match visible: the
 * unreachable direction shares the targeted one's name prefix, and the
 * adjacency-less specialty's direction is named as a near-twin of the adjacent
 * one. Nothing may enter the feed except through an active, managed
 * `specialty → direction (→ adjacency) → event` row chain.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "019 EARS-3 doctor events feed (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const directionIds: string[] = [];
    const linkIds: string[] = [];
    const edgeIds: string[] = [];
    const eventIds: string[] = [];
    const eventDirectionIds: string[] = [];

    /** Specialty codes: one with adjacency, one deliberately without. */
    let adjacentCarryingCode = "";
    let lonelyCode = "";
    /** A third specialty whose direction carries only the tense fixtures (row 30). */
    let tenseCode = "";

    let today = "";
    let ownEventId = "";
    let secondOwnEventId = "";
    let adjacentEventId = "";
    let unreachableEventId = "";
    let farEventId = "";
    let lonelyEventId = "";
    /** Far past the default horizon, on the adjacency-less direction (EARS-3.7/3.8/9.1). */
    let lonelyFarEventId = "";
    /** The adjacency-less direction (the facet-narrowed «показать ещё» case). */
    let lonelyDirectionId = "";
    let expertsEventId = "";
    /** «Прошедшие» fixtures on the adjacency-less direction (gate rows 10/30/31/32). */
    let pastMontageEventId = "";
    let pastRawEventId = "";
    let pastPreparingEventId = "";
    let pastAbsentEventId = "";
    let pastOldEventId = "";
    let pastAncientEventId = "";
    /** Tense fixtures (row 30): today's three lifecycle answers + steps beyond both extents. */
    let todayNotStartedId = "";
    let todayLiveId = "";
    let todayEndedId = "";
    let upcomingStepIds: string[] = [];
    let upcomingFarId = "";
    let pastStepId = "";
    let pastFarId = "";

    const at = (dayOffset: number, hour: number) =>
      new Date(
        `${addDoctorEventsFeedDays(today, dayOffset)}T${String(hour).padStart(2, "0")}:00:00+03:00`,
      );

    const makeDirection = async (title: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directions (id, slug, title, status, first_published_at) VALUES ($1, $2, $3, 'published', now())",
        [id, `feed-${randomUUID()}`, `${title} ${randomUUID().slice(0, 8)}`],
      );
      directionIds.push(id);
      return id;
    };

    const linkSpecialty = async (directionId: string, specialtyId: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_specialties (id, direction_id, specialty_minzdrav_id, status) VALUES ($1, $2, $3, 'active')",
        [id, directionId, specialtyId],
      );
      linkIds.push(id);
    };

    const makeEdge = async (from: string, to: string) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO direction_adjacency (id, direction_id, adjacent_direction_id, kind, weight, status) VALUES ($1, $2, $3, 'related', 10, 'active')",
        [id, from, to],
      );
      edgeIds.push(id);
    };

    const makeEvent = async (input: {
      title: string;
      startsAt: Date;
      directionId: string;
      /** 012 EARS-29 — the storefront selector; the doctor feed selects `doctors`. */
      audience?: "doctors" | "experts";
      state?: "published" | "live" | "ended";
      durationMin?: number;
    }) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience) VALUES ($1, $2, $3, $4, $5, $7, $6, ${eventClassificationSql(input.audience ?? "doctors")})`,
        [
          id,
          `feed-${randomUUID()}`,
          input.title,
          "Школа 019",
          input.startsAt.toISOString(),
          input.state ?? "published",
          input.durationMin ?? 60,
        ],
      );
      eventIds.push(id);

      const linkId = randomUUID();
      await pool.query(
        "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
        [linkId, id, input.directionId],
      );
      eventDirectionIds.push(linkId);
      return id;
    };

    const addRecording = async (
      eventId: string,
      kind: "edited" | "raw",
      status: "draft" | "published",
      durationSec: number | null = null,
    ) => {
      await pool.query(
        `INSERT INTO event_recordings (event_id, kind, provider, embed_ref, status, first_published_at, duration_sec)
         VALUES ($1, $2, 'rutube', '0123456789abcdef0123456789abcdef', $3, ${status === "published" ? "now()" : "NULL"}, $4)`,
        [eventId, kind, status, durationSec],
      );
    };

    const readFeed = async (input: {
      specialtyCode: string;
      query?: string;
    }) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/storefront/doctor/events${input.query ?? ""}`,
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(input.specialtyCode)}`,
        },
      });
      expect(response.statusCode).toBe(200);
      const body: unknown = response.json();
      // The envelope is validated against the SSOT on every read: the schema is
      // `.strict()`, so a stray ranking/personalisation field fails HERE.
      return DoctorEventsFeedSchema.parse(body);
    };

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      today = doctorEventsFeedDayOf(new Date());

      const specialties = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 3",
      );
      const [withAdjacency, lonely, tenseSpecialty] = specialties.rows;
      adjacentCarryingCode = withAdjacency!.code;
      lonelyCode = lonely!.code;
      tenseCode = tenseSpecialty!.code;

      const own = await makeDirection("Кардиология");
      const adjacent = await makeDirection("Функциональная диагностика");
      // Shares the targeted direction's name prefix and is reachable from
      // nothing — a likeness-based resolver would pull it in.
      const unreachable = await makeDirection("Кардиология");
      const lonelyDirection = await makeDirection(
        "Функциональная диагностика смежная",
      );

      await linkSpecialty(own, withAdjacency!.id);
      await linkSpecialty(lonelyDirection, lonely!.id);
      lonelyDirectionId = lonelyDirection;
      const tenseDirection = await makeDirection("Тенз ленты");
      await linkSpecialty(tenseDirection, tenseSpecialty!.id);
      await makeEdge(own, adjacent);

      ownEventId = await makeEvent({
        title: "Своё направление, утро",
        startsAt: at(1, 9),
        directionId: own,
      });
      secondOwnEventId = await makeEvent({
        title: "Своё направление, вечер",
        startsAt: at(1, 18),
        directionId: own,
      });
      adjacentEventId = await makeEvent({
        title: "Смежное направление",
        startsAt: at(3, 12),
        directionId: adjacent,
      });
      unreachableEventId = await makeEvent({
        title: "Похожее по названию, но не связанное",
        startsAt: at(2, 12),
        directionId: unreachable,
      });
      farEventId = await makeEvent({
        title: "За горизонтом по умолчанию",
        startsAt: at(20, 12),
        directionId: own,
      });
      lonelyEventId = await makeEvent({
        title: "Специальность без смежностей",
        startsAt: at(2, 15),
        directionId: lonelyDirection,
      });
      // Far out: a stated window that stops short of it must name a `nextTo`
      // that covers it, never an empty widening.
      lonelyFarEventId = await makeEvent({
        title: "Через сорок дней",
        startsAt: at(40, 12),
        directionId: lonelyDirection,
      });
      // Same direction and day as the own events, but for the Academy audience.
      expertsEventId = await makeEvent({
        title: "Эфир для экспертов",
        startsAt: at(1, 16),
        directionId: own,
        audience: "experts",
      });

      // «Прошедшие»: three recording answers in the last days, one with no
      // recording row at all, and one 30 days back — older than a stated
      // 14-day `from`, so from there only a BACKWARD widening reaches it.
      pastMontageEventId = await makeEvent({
        title: "Прошедший, смонтирован",
        startsAt: at(-3, 12),
        directionId: lonelyDirection,
        state: "ended",
      });
      await addRecording(pastMontageEventId, "edited", "published", 54 * 60);
      pastRawEventId = await makeEvent({
        title: "Прошедший, только исходник",
        startsAt: at(-4, 12),
        directionId: lonelyDirection,
        state: "ended",
      });
      await addRecording(pastRawEventId, "raw", "published");
      pastPreparingEventId = await makeEvent({
        title: "Прошедший, запись готовится",
        startsAt: at(-5, 12),
        directionId: lonelyDirection,
        state: "ended",
      });
      await addRecording(pastPreparingEventId, "edited", "draft");
      pastAbsentEventId = await makeEvent({
        title: "Прошедший, без записи",
        startsAt: at(-6, 12),
        directionId: lonelyDirection,
        state: "ended",
      });
      pastOldEventId = await makeEvent({
        title: "Прошедший месяц назад",
        startsAt: at(-30, 12),
        directionId: lonelyDirection,
        state: "ended",
      });
      // Older than a year: «Прошедшие» has no age floor, so the archive must
      // still reach it by repeated «Показать ещё».
      pastAncientEventId = await makeEvent({
        title: "Прошедший больше года назад",
        startsAt: at(-400, 12),
        directionId: lonelyDirection,
        state: "ended",
      });

      // Row 30 — the tense is a lifecycle split, not a date split: today's
      // not-started and live эфиры belong to «Будущие», today's ended one to
      // «Прошедшие», whatever window either read covers.
      todayNotStartedId = await makeEvent({
        title: "Сегодня, ещё не начался",
        startsAt: at(0, 23),
        directionId: tenseDirection,
      });
      todayLiveId = await makeEvent({
        title: "Сегодня, в эфире",
        startsAt: at(0, 12),
        directionId: tenseDirection,
        state: "live",
        durationMin: 600,
      });
      todayEndedId = await makeEvent({
        title: "Сегодня, завершён",
        startsAt: at(0, 1),
        directionId: tenseDirection,
        state: "ended",
      });
      // Beyond a stated «Будущие» [today, +14): two near, one far.
      upcomingStepIds = [
        await makeEvent({
          title: "Через 20 дней",
          startsAt: at(20, 12),
          directionId: tenseDirection,
        }),
        await makeEvent({
          title: "Через 22 дня",
          startsAt: at(22, 12),
          directionId: tenseDirection,
        }),
      ];
      upcomingFarId = await makeEvent({
        title: "Через 50 дней",
        startsAt: at(50, 12),
        directionId: tenseDirection,
      });
      // Beyond a stated «Прошедшие» [−14, +1): one 20 days back, one far.
      pastStepId = await makeEvent({
        title: "20 дней назад",
        startsAt: at(-20, 12),
        directionId: tenseDirection,
        state: "ended",
      });
      pastFarId = await makeEvent({
        title: "50 дней назад",
        startsAt: at(-50, 12),
        directionId: tenseDirection,
        state: "ended",
      });
    }, 60_000);

    afterAll(async () => {
      for (const id of eventDirectionIds) {
        await pool.query("DELETE FROM event_directions WHERE id = $1", [id]);
      }
      for (const id of eventIds) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of edgeIds) {
        await pool.query("DELETE FROM direction_adjacency WHERE id = $1", [id]);
      }
      for (const id of linkIds) {
        await pool.query("DELETE FROM direction_specialties WHERE id = $1", [
          id,
        ]);
      }
      for (const id of directionIds) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      await app?.close();
    });

    it("EARS-3.1: groups the targeted events by day within the horizon and admits only managed own + adjacent directions", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });

      expect(feed.targeting.mode).toBe("targeted");
      expect(feed.targeting.adjacentDirectionIds.length).toBeGreaterThan(0);
      expect(feed.from).toBe(today);

      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(ownEventId);
      expect(ids).toContain(secondOwnEventId);
      expect(ids).toContain(adjacentEventId);
      // No managed row reaches it — a shared name prefix is not a relation.
      expect(ids).not.toContain(unreachableEventId);
      expect(ids).not.toContain(lonelyEventId);
      // Fewer than 10 upcoming events: the default screen holds them all,
      // however far ahead (LD-2, #2884).
      expect(ids).toContain(farEventId);

      const ownDay = addDoctorEventsFeedDays(today, 1);
      const group = feed.days.find((day) => day.day === ownDay);
      expect(group?.items.map((item) => item.id)).toEqual([
        ownEventId,
        secondOwnEventId,
      ]);
      expect(group?.label).toMatch(/\S/);

      // Day groups ascend and each day appears exactly once.
      const days = feed.days.map((day) => day.day);
      expect(days).toEqual([...days].sort());
      expect(new Set(days).size).toBe(days.length);
      // Every rendered event falls inside the declared horizon.
      for (const day of days) {
        expect(day >= feed.from && day < feed.to).toBe(true);
      }
    });

    it("019 EARS-2: the feed selects only events whose audience is doctors — an experts event on a targeted direction never appears (012 EARS-29)", async () => {
      const feed = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: "?specialty=all",
      });
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(ownEventId);
      expect(ids).not.toContain(expertsEventId);
    });

    it("EARS-3.2: a specialty with no adjacency rows yields no adjacent items", async () => {
      const feed = await readFeed({ specialtyCode: lonelyCode });

      expect(feed.targeting.adjacentDirectionIds).toEqual([]);
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toEqual([lonelyEventId, lonelyFarEventId]);
      // The near-twin name of the adjacent direction pulls nothing in.
      expect(ids).not.toContain(adjacentEventId);
      expect(ids).not.toContain(ownEventId);
    });

    it("NEW: 019 LD-2 (#2884) — «Будущие» pages by count: with ≤10 upcoming events the screen holds them all and offers no «показать ещё»; with more it holds the 10 nearest and each step adds the next 10, the last the remainder", async () => {
      const idsOf = (feed: { days: { items: { id: string }[] }[] }) =>
        feed.days.flatMap((day) => day.items.map((item) => item.id));
      // Two upcoming events (+2, +40): both, however far apart, no step.
      const few = await readFeed({ specialtyCode: lonelyCode });
      expect(idsOf(few)).toEqual([lonelyEventId, lonelyFarEventId]);
      expect(few.from).toBe(today);
      expect(few.to).toBe(addDoctorEventsFeedDays(today, 41));
      expect(few.nextTo).toBeNull();
      expect(few.remaining).toBe(0);
      expect(few.nextBatch).toBe(0);

      // Twenty-one more, one a day at +3…+23: 23 upcoming in all.
      const added: string[] = [];
      for (let day = 3; day <= 23; day += 1) {
        added.push(
          await makeEvent({
            title: `Шаг ленты ${day}`,
            startsAt: at(day, 12),
            directionId: lonelyDirectionId,
          }),
        );
      }
      try {
        const first = await readFeed({ specialtyCode: lonelyCode });
        expect(idsOf(first)).toHaveLength(10);
        expect(idsOf(first)[0]).toBe(lonelyEventId);
        expect(first.to).toBe(addDoctorEventsFeedDays(today, 12));
        expect(first.nextBatch).toBe(10);
        expect(first.remaining).toBe(13);
        expect(first.nextTo).toBe(addDoctorEventsFeedDays(today, 22));

        const second = await readFeed({
          specialtyCode: lonelyCode,
          query: `?from=${first.from}&to=${first.nextTo!}`,
        });
        expect(idsOf(second)).toHaveLength(20);
        expect(second.nextBatch).toBe(3);
        expect(second.remaining).toBe(3);
        expect(second.nextTo).toBe(addDoctorEventsFeedDays(today, 41));

        const last = await readFeed({
          specialtyCode: lonelyCode,
          query: `?from=${second.from}&to=${second.nextTo!}`,
        });
        expect(idsOf(last)).toHaveLength(23);
        expect(idsOf(last).at(-1)).toBe(lonelyFarEventId);
        expect(last.nextTo).toBeNull();
        expect(last.remaining).toBe(0);
      } finally {
        for (const id of added) {
          await pool.query("DELETE FROM event_directions WHERE event_id = $1", [
            id,
          ]);
          await pool.query("DELETE FROM events WHERE id = $1", [id]);
        }
      }
    });

    it("EARS-3.3: the response carries no ranking, score or personalisation field", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });

      const serialized = JSON.stringify(feed);
      for (const forbidden of [
        "score",
        "rank",
        "ranking",
        "relevance",
        "personal",
        "weight",
        "boost",
      ]) {
        expect(serialized.toLowerCase()).not.toContain(`"${forbidden}`);
      }
      const cardKeys = new Set(
        feed.days.flatMap((day) =>
          day.items.flatMap((item) => Object.keys(item)),
        ),
      );
      expect([...cardKeys].some((key) => /score|rank|weight/i.test(key))).toBe(
        false,
      );
    });

    it("EARS-3.4: «показать ещё» extends the horizon named in the URL and only then reveals the later event", async () => {
      // A URL with an explicit range still addresses that range (#2884).
      const first = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 5)}`,
      });
      expect(first.to).toBe(addDoctorEventsFeedDays(today, 5));
      expect(
        first.days.flatMap((day) => day.items.map((item) => item.id)),
      ).not.toContain(farEventId);
      expect(first.nextTo).not.toBeNull();
      expect(first.nextTo! > first.to).toBe(true);

      const extended = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: `?from=${first.from}&to=${first.nextTo!}`,
      });
      expect(extended.to).toBe(first.nextTo);
      const ids = extended.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(ids).toContain(farEventId);
      expect(extended.totalCount).toBeGreaterThan(first.totalCount);
    });

    it("EARS-3.5: a card's own `kind.slug` round-trips into `?kind=`, and a malformed `kind` is a 4xx, never a 500", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });
      const card = feed.days.flatMap((day) => day.items).at(0);
      expect(card).toBeDefined();
      // The card's stored kind (012 event-kind dictionary, 019 amendment) IS the
      // facet vocabulary — feeding its slug back filters.
      expect(card!.kind.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(card!.kind.title.length).toBeGreaterThan(0);

      const roundTripped = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: `?kind=${card!.kind.slug}`,
      });
      const roundTrippedIds = roundTripped.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(roundTrippedIds).toContain(card!.id);

      // A hand-edited value outside the slug grammar is refused at the boundary.
      const rejected = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events?kind=Not_A_Slug",
      });
      expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
      expect(rejected.statusCode).toBeLessThan(500);
    });

    it("NEW: the feed carries the doctor facet options — every kind of the tense with its count under the other facets, a zero-yield option kept (row 58, D9)", async () => {
      const feed = await readFeed({ specialtyCode: adjacentCarryingCode });
      const kinds = feed.facets?.kind ?? [];
      const card = feed.days.flatMap((day) => day.items).at(0)!;
      const option = kinds.find((entry) => entry.slug === card.kind.slug);
      expect(option?.title).toBe(card.kind.title);
      expect(option!.count).toBeGreaterThanOrEqual(1);
      // Ordered by title, then slug — the Academy options' order.
      const order = kinds.map((entry) => `${entry.title}\u0000${entry.slug}`);
      expect(order).toEqual([...order].sort());
      // A kind's own selection never narrows its own options …
      const picked = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: `?kind=${card.kind.slug}`,
      });
      expect(picked.facets?.kind.map((entry) => entry.slug)).toEqual(
        kinds.map((entry) => entry.slug),
      );
      // … while another facet that selects nothing keeps every option at 0.
      const narrowed = await readFeed({
        specialtyCode: adjacentCarryingCode,
        query: "?city=Нигдеград",
      });
      expect(narrowed.facets?.kind.map((entry) => entry.slug)).toEqual(
        kinds.map((entry) => entry.slug),
      );
      expect(narrowed.facets?.kind.every((entry) => entry.count === 0)).toBe(
        true,
      );
      // No card carries a city today (007 authors none) — so no city option.
      expect(feed.facets?.city).toEqual([]);
    });

    it("NEW: a facet-narrowed feed names the next bound and the remainder of the narrowed set — `format` and `kind` live in the one SQL predicate (row 58, #1805)", async () => {
      // An offline event at +20 sits between a stated window [today, +14) and
      // the online +40 event: unfaceted the next step takes both; under
      // `format=online` the probe must skip it, and under `format=offline` it
      // is all there is.
      const offlineId = await makeEvent({
        title: "Очное событие",
        startsAt: at(20, 12),
        directionId: lonelyDirectionId,
      });
      await pool.query(
        "UPDATE events SET participation_format = 'offline' WHERE id = $1",
        [offlineId],
      );
      try {
        const window = `from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`;
        const all = await readFeed({
          specialtyCode: lonelyCode,
          query: `?${window}`,
        });
        expect(all.nextTo).toBe(addDoctorEventsFeedDays(today, 41));
        expect(all.remaining).toBe(2);
        expect(all.nextBatch).toBe(2);

        const online = await readFeed({
          specialtyCode: lonelyCode,
          query: `?${window}&format=online`,
        });
        expect(online.nextTo).toBe(addDoctorEventsFeedDays(today, 41));
        expect(online.remaining).toBe(1);
        expect(online.nextBatch).toBe(1);

        const offline = await readFeed({
          specialtyCode: lonelyCode,
          query: "?format=offline",
        });
        // The default screen is the nearest matching events: the +20 event,
        // nothing beyond it.
        expect(
          offline.days.flatMap((day) => day.items.map((item) => item.id)),
        ).toEqual([offlineId]);
        expect(offline.to).toBe(addDoctorEventsFeedDays(today, 21));
        expect(offline.nextTo).toBeNull();
        expect(offline.remaining).toBe(0);

        const card = all.days.flatMap((day) => day.items).at(0)!;
        const kindAndOffline = await readFeed({
          specialtyCode: lonelyCode,
          query: `?format=offline&kind=${card.kind.slug}`,
        });
        expect(kindAndOffline.totalCount + kindAndOffline.remaining).toBe(1);
        const noKind = await readFeed({
          specialtyCode: lonelyCode,
          query: "?kind=no-such-kind",
        });
        expect(noKind.nextTo).toBeNull();
        expect(noKind.remaining).toBe(0);
        // The kind options count under the `format` selection, in SQL.
        expect(
          offline.facets?.kind.find((entry) => entry.slug === card.kind.slug)
            ?.count,
        ).toBe(1);
      } finally {
        await pool.query("DELETE FROM event_directions WHERE event_id = $1", [
          offlineId,
        ]);
        await pool.query("DELETE FROM events WHERE id = $1", [offlineId]);
      }
    });

    it("EARS-3.6: a stale specialty cookie degrades to the untargeted feed instead of refusing it (EARS-12)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events",
        headers: {
          cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(
            `left-the-book-${randomUUID()}`,
          )}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const feed = DoctorEventsFeedSchema.parse(response.json());
      expect(feed.targeting.mode).toBe("all");
      expect(feed.targeting.specialtyReference).toBeNull();
      expect(feed.targeting.directionIds).toEqual([]);
      // The untargeted read is the WIDE one — the events a targeted read would
      // have hidden are present, so this is a degradation, not an empty feed.
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(unreachableEventId);
    });

    it("EARS-3.7: with nothing beyond the horizon, `nextTo` is null so «показать ещё» is never offered into an empty widening", async () => {
      // The adjacency-less specialty owns exactly two events, at +2 and +40;
      // a window through +60 therefore has nothing left to walk to.
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 60)}`,
      });

      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toEqual([lonelyEventId, lonelyFarEventId]);
      expect(feed.nextTo).toBeNull();
    });

    it("EARS-3.8: the next `to` COVERS the next events beyond the horizon, in whole days", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      });
      expect(feed.to).toBe(addDoctorEventsFeedDays(today, 14));
      // The next step's last event is the +40 one: the bound is the day after.
      expect(feed.nextTo).toBe(addDoctorEventsFeedDays(today, 41));

      const extended = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${feed.from}&to=${feed.nextTo}`,
      });
      const ids = extended.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(ids).toContain(lonelyFarEventId);
    });

    it("NEW: a facet whose matches all lie far away opens on them — the default screen is the nearest matches (both tenses, doctor host, #1973, #2884)", async () => {
      const idsOf = (feed: { days: { items: { id: string }[] }[] }) =>
        feed.days.flatMap((day) => day.items.map((item) => item.id));
      // Only the +40 event matches: the default screen holds it.
      const upcoming = await readFeed({
        specialtyCode: lonelyCode,
        query: `?q=${encodeURIComponent("Через сорок дней")}`,
      });
      expect(idsOf(upcoming)).toEqual([lonelyFarEventId]);
      expect(upcoming.from).toBe(today);
      expect(upcoming.to).toBe(addDoctorEventsFeedDays(today, 41));
      expect(upcoming.nextTo).toBeNull();
      expect(upcoming.remaining).toBe(0);

      // Only the −30 event matches: the default screen reaches back to it.
      const past = await readFeed({
        specialtyCode: lonelyCode,
        query: `?tense=past&q=${encodeURIComponent("Прошедший месяц назад")}`,
      });
      expect(idsOf(past)).toEqual([pastOldEventId]);
      expect(past.to).toBe(addDoctorEventsFeedDays(today, 1));
      expect(past.nextFrom).toBeNull();
      expect(past.remaining).toBe(0);
    });

    it("EARS-9.1: an empty window whose future is non-empty still offers «показать ещё»", async () => {
      const from = addDoctorEventsFeedDays(today, 20);
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${from}&to=${addDoctorEventsFeedDays(today, 25)}`,
      });

      expect(feed.totalCount).toBe(0);
      expect(feed.days).toEqual([]);
      // The emptiness is the WINDOW's, not the feed's — the +40 event is still
      // reachable, so the control stays offered and its target covers it.
      expect(feed.nextTo).not.toBeNull();
      expect(feed.nextTo! > addDoctorEventsFeedDays(today, 40)).toBe(true);
    });

    it("D10: every feed read carries the api's today (МСК), whatever extent the URL echoes", async () => {
      // A stale shared link: its `from` is days before today.
      const stale = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${addDoctorEventsFeedDays(today, -3)}&to=${addDoctorEventsFeedDays(today, 20)}`,
      });
      expect(stale.from).toBe(addDoctorEventsFeedDays(today, -3));
      expect(stale.today).toBe(doctorEventsFeedDayOf(new Date()));
      const past = await readFeed({
        specialtyCode: lonelyCode,
        query: "?tense=past",
      });
      expect(past.today).toBe(doctorEventsFeedDayOf(new Date()));
    });

    it("NEW: «Прошедшие» extends BACKWARD by a count step — from a stated `from`, `nextFrom` takes in the next (up to 10) older events, in whole days (rows 30, 32; LD-2)", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: `?tense=past&from=${addDoctorEventsFeedDays(today, -14)}`,
      });
      expect(feed.from).toBe(addDoctorEventsFeedDays(today, -14));
      expect(feed.to).toBe(addDoctorEventsFeedDays(today, 1));
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).not.toContain(pastOldEventId);
      // The past extent never widens forward.
      expect(feed.nextTo).toBeNull();
      // The −30 and −400 events lie beyond — fewer than the step of 10, so
      // the next bound is the oldest one's day and the step adds both.
      expect(feed.nextFrom).toBe(addDoctorEventsFeedDays(today, -400));
      expect(feed.remaining).toBe(2);
      expect(feed.nextBatch).toBe(2);

      const extended = await readFeed({
        specialtyCode: lonelyCode,
        query: `?tense=past&from=${feed.nextFrom!}&to=${feed.to}`,
      });
      expect(extended.from).toBe(feed.nextFrom);
      const extendedIds = extended.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(extendedIds).toContain(pastOldEventId);
      expect(extendedIds).toContain(pastAncientEventId);
      expect(extended.remaining).toBe(0);
    });

    it("NEW: 019 LD-2 — the default «Прошедшие» screen is the 10 most recent past events however old: with fewer, the 400-days-back archive event reads at once and nothing lies beyond (014 archive)", async () => {
      const first = await readFeed({
        specialtyCode: lonelyCode,
        query: "?tense=past",
      });
      const ids = first.days.flatMap((day) => day.items.map((item) => item.id));
      expect(first.from).toBe(addDoctorEventsFeedDays(today, -400));
      expect(first.to).toBe(addDoctorEventsFeedDays(today, 1));
      expect(ids).toContain(pastOldEventId);
      expect(ids).toContain(pastAncientEventId);
      expect(first.nextFrom).toBeNull();
      expect(first.remaining).toBe(0);
      expect(first.nextBatch).toBe(0);
    });

    it("NEW: a hostile ancient past `from` is clamped to the earliest matching event's day — never to a year — and the recent days stay", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: `?tense=past&from=${addDoctorEventsFeedDays(today, -5000)}`,
      });
      expect(feed.to).toBe(addDoctorEventsFeedDays(today, 1));
      expect(feed.from).toBe(addDoctorEventsFeedDays(today, -400));
      expect(feed.totalCount).toBeLessThanOrEqual(EVENT_HORIZON_ROW_CAP);
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(pastMontageEventId);
      expect(ids).toContain(pastAncientEventId);
      expect(feed.nextFrom).toBeNull();
      expect(feed.remaining).toBe(0);
    });

    it("NEW: «Показать ещё» states the next batch and the remainder — `remaining` counts the matching events beyond the extent", async () => {
      const first = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      });
      // Only the +40 event lies past the stated window.
      expect(first.remaining).toBe(1);
      expect(first.nextFrom).toBeNull();

      const all = await readFeed({
        specialtyCode: lonelyCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 60)}`,
      });
      expect(all.remaining).toBe(0);
      expect(all.nextTo).toBeNull();

      // The remainder obeys the card facets the window obeys: an offline-only
      // read matches none of the (online) events beyond it.
      const offline = await readFeed({
        specialtyCode: lonelyCode,
        query: "?format=offline",
      });
      expect(offline.remaining).toBe(0);
      expect(offline.nextTo).toBeNull();
    });

    it("NEW: doctor host — a past card carries the recording projection the Academy card carries: montage / raw-only playable, preparing / absent not (rows 10, 31)", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: "?tense=past",
      });
      const card = (id: string) =>
        feed.days.flatMap((day) => day.items).find((item) => item.id === id);

      expect(card(pastMontageEventId)?.recording?.state).toBe("montage");
      expect(card(pastMontageEventId)?.recording?.primaryKind).toBe("edited");
      expect(card(pastRawEventId)?.recording?.state).toBe("raw-only");
      expect(card(pastRawEventId)?.recording?.primaryKind).toBe("raw");
      expect(card(pastPreparingEventId)?.recording?.state).toBe("preparing");
      expect(card(pastPreparingEventId)?.recording?.primaryKind).toBeNull();
      expect(card(pastAbsentEventId)?.recording?.state).toBe("preparing");
      expect(card(pastAbsentEventId)?.recording?.primaryKind).toBeNull();

      // An upcoming card carries no recording answer at all.
      const upcoming = await readFeed({ specialtyCode: lonelyCode });
      const next = upcoming.days.flatMap((day) => day.items).at(0);
      expect(next).toBeDefined();
      expect(next?.recording).toBeUndefined();
    });
    it("NEW: «Будущие» lists today's not-started and live эфиры and never today's ended one (row 30)", async () => {
      const feed = await readFeed({ specialtyCode: tenseCode });
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(todayNotStartedId);
      expect(ids).toContain(todayLiveId);
      expect(ids).not.toContain(todayEndedId);
      // Soonest first.
      expect(ids.indexOf(todayLiveId)).toBeLessThan(
        ids.indexOf(todayNotStartedId),
      );
      expect(
        feed.days
          .flatMap((day) => day.items)
          .every((item) => item.state !== "recorded"),
      ).toBe(true);
    });

    it("NEW: «Прошедшие» lists today's ended эфир and never today's not-started or live one (row 30)", async () => {
      const feed = await readFeed({
        specialtyCode: tenseCode,
        query: "?tense=past",
      });
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toContain(todayEndedId);
      expect(ids).not.toContain(todayNotStartedId);
      expect(ids).not.toContain(todayLiveId);
      expect(
        feed.days
          .flatMap((day) => day.items)
          .every((item) => item.state === "recorded"),
      ).toBe(true);
    });

    it("NEW: «Прошедшие» reads newest first — days and the events within them (row 30, LD-13)", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: "?tense=past",
      });
      const days = feed.days.map((day) => day.day);
      expect(days).toEqual([...days].sort().reverse());
      const ids = feed.days.flatMap((day) => day.items.map((item) => item.id));
      expect(ids).toEqual([
        pastMontageEventId,
        pastRawEventId,
        pastPreparingEventId,
        pastAbsentEventId,
        pastOldEventId,
        pastAncientEventId,
      ]);
    });

    it("NEW: `nextBatch` is exactly the events the next widening step adds, beside `remaining` (row 32)", async () => {
      // From a stated [today, +14) the three later events are fewer than the
      // step of 10, so one step adds them all (LD-2).
      const upcoming = await readFeed({
        specialtyCode: tenseCode,
        query: `?from=${today}&to=${addDoctorEventsFeedDays(today, 14)}`,
      });
      expect(upcoming.remaining).toBe(3);
      expect(upcoming.nextBatch).toBe(3);
      const widened = await readFeed({
        specialtyCode: tenseCode,
        query: `?from=${upcoming.from}&to=${upcoming.nextTo!}`,
      });
      const before = new Set(
        upcoming.days.flatMap((day) => day.items.map((item) => item.id)),
      );
      const added = widened.days
        .flatMap((day) => day.items.map((item) => item.id))
        .filter((id) => !before.has(id));
      expect([...added].sort()).toEqual(
        [...upcomingStepIds, upcomingFarId].sort(),
      );
      expect(widened.nextBatch).toBe(0);
      expect(widened.remaining).toBe(0);
      expect(widened.nextTo).toBeNull();

      // «Прошедшие» steps by count (LD-2): from a stated 14-day `from`, the
      // two older events are fewer than the step of 10, so one step adds both.
      const past = await readFeed({
        specialtyCode: tenseCode,
        query: `?tense=past&from=${addDoctorEventsFeedDays(today, -14)}`,
      });
      expect(past.remaining).toBe(2);
      expect(past.nextBatch).toBe(2);
      const older = await readFeed({
        specialtyCode: tenseCode,
        query: `?tense=past&from=${past.nextFrom!}&to=${past.to}`,
      });
      const olderIds = older.days.flatMap((day) =>
        day.items.map((item) => item.id),
      );
      expect(olderIds).toContain(pastStepId);
      expect(olderIds).toContain(pastFarId);
      expect(older.totalCount - past.totalCount).toBe(past.nextBatch);
    });

    it("NEW: a published recording carries its duration for the card's «Запись · N мин» line (rows 10, 31)", async () => {
      const feed = await readFeed({
        specialtyCode: lonelyCode,
        query: "?tense=past",
      });
      const card = (id: string) =>
        feed.days.flatMap((day) => day.items).find((item) => item.id === id);
      expect(card(pastMontageEventId)?.recording?.durationSec).toBe(54 * 60);
      expect(card(pastRawEventId)?.recording?.durationSec).toBeNull();
      expect(card(pastAbsentEventId)?.recording?.durationSec).toBeNull();
    });

    describe("past the row cap — the capped window slides with «Показать ещё» (row 32)", () => {
      /** More events than the cap in EACH tense, two a day, on their own specialty. */
      const CAP_WALK_COUNT = EVENT_HORIZON_ROW_CAP + 40;
      let capCode = "";
      let pastWalkIds: string[] = [];
      let upcomingWalkIds: string[] = [];
      const capLinkIds: string[] = [];

      const seedWalk = async (
        directionId: string,
        anchor: Date,
        sign: 1 | -1,
        state: "published" | "ended",
      ) => {
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience)
           SELECT gen_random_uuid(), 'cap-walk-' || g || '-' || $4, 'Окно ленты ' || g, 'Школа 019',
                  $1::timestamptz + $3::int * g * interval '12 hours', 60, $5, ${eventClassificationSql("doctors")}
           FROM generate_series(0, $2::int - 1) AS g
           RETURNING id`,
          [
            anchor.toISOString(),
            CAP_WALK_COUNT,
            sign,
            randomUUID().slice(0, 8),
            state,
          ],
        );
        const ids = inserted.rows.map((row) => row.id);
        const links = await pool.query<{ id: string }>(
          `INSERT INTO event_directions (id, event_id, direction_id, status)
           SELECT gen_random_uuid(), unnest($1::uuid[]), $2, 'active'
           RETURNING id`,
          [ids, directionId],
        );
        capLinkIds.push(...links.rows.map((row) => row.id));
        return ids;
      };

      beforeAll(async () => {
        const specialty = await pool.query<{ id: string; code: string }>(
          "SELECT id, code FROM specialties_minzdrav WHERE is_other = false ORDER BY code OFFSET 3 LIMIT 1",
        );
        capCode = specialty.rows[0]!.code;
        const direction = await makeDirection("Окно ленты");
        await linkSpecialty(direction, specialty.rows[0]!.id);
        pastWalkIds = await seedWalk(direction, at(-20, 12), -1, "ended");
        upcomingWalkIds = await seedWalk(direction, at(20, 12), 1, "published");
      });

      afterAll(async () => {
        await pool.query(
          "DELETE FROM event_directions WHERE id = ANY($1::uuid[])",
          [capLinkIds],
        );
        await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [
          [...pastWalkIds, ...upcomingWalkIds],
        ]);
      });

      const idsOf = (feed: { days: { items: { id: string }[] }[] }) =>
        feed.days.flatMap((day) => day.items.map((item) => item.id));

      it("NEW: «Прошедшие» past the cap — every «Показать ещё» returns new events, the page stays within the cap, the walk reaches the oldest event and ends", async () => {
        // «Прошедшие» steps by 10 events (LD-2): the walk starts a few steps
        // short of the cap, from a stated `from` (two events a day).
        const nearCap = doctorEventsFeedDayOf(
          new Date(
            at(-20, 12).getTime() -
              (EVENT_HORIZON_ROW_CAP - 15) * 12 * 60 * 60_000,
          ),
        );
        let feed = await readFeed({
          specialtyCode: capCode,
          query: `?tense=past&from=${nearCap}`,
        });
        let steps = 0;
        let crossed = false;
        while (feed.nextFrom !== null) {
          const previous = new Set(idsOf(feed));
          // «Показать ещё» writes BOTH returned bounds into the URL.
          const next = await readFeed({
            specialtyCode: capCode,
            query: `?tense=past&from=${feed.nextFrom}&to=${feed.to}`,
          });
          expect(next.totalCount).toBeLessThanOrEqual(EVENT_HORIZON_ROW_CAP);
          expect(idsOf(next).some((id) => !previous.has(id))).toBe(true);
          if (next.to < feed.to) crossed = true;
          feed = next;
          expect(++steps).toBeLessThan(200);
        }
        expect(crossed).toBe(true);
        expect(idsOf(feed)).toContain(pastWalkIds.at(-1));
        expect(feed.remaining).toBe(0);
        expect(feed.nextBatch).toBe(0);
      });

      it("NEW: «Будущие» past the cap — every «Показать ещё» returns new events, the page stays within the cap, the walk reaches the farthest event and ends", async () => {
        // «Будущие» steps by 10 events too (LD-2, #2884): the walk starts a
        // few steps short of the cap, from a stated `to` (two events a day).
        const nearCap = addDoctorEventsFeedDays(
          doctorEventsFeedDayOf(
            new Date(
              at(20, 12).getTime() +
                (EVENT_HORIZON_ROW_CAP - 15) * 12 * 60 * 60_000,
            ),
          ),
          1,
        );
        let feed = await readFeed({
          specialtyCode: capCode,
          query: `?from=${today}&to=${nearCap}`,
        });
        let steps = 0;
        let crossed = false;
        while (feed.nextTo !== null) {
          const previous = new Set(idsOf(feed));
          const next = await readFeed({
            specialtyCode: capCode,
            query: `?from=${feed.from}&to=${feed.nextTo}`,
          });
          expect(next.totalCount).toBeLessThanOrEqual(EVENT_HORIZON_ROW_CAP);
          expect(idsOf(next).some((id) => !previous.has(id))).toBe(true);
          if (next.from > feed.from) crossed = true;
          feed = next;
          expect(++steps).toBeLessThan(200);
        }
        expect(crossed).toBe(true);
        expect(idsOf(feed)).toContain(upcomingWalkIds.at(-1));
        expect(feed.remaining).toBe(0);
        expect(feed.nextBatch).toBe(0);
      });
    });
  },
);

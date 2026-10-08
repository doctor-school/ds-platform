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
  MonthBroadcastListSchema,
  MonthlyEventCountsSchema,
  PublicEventListingPageSchema,
  addDoctorEventsFeedDays,
  doctorEventsFeedDayOf,
  doctorEventsMonthOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 014 EARS-12 (wave-2 entry gate §4.2, PR 2.5) — the Academy facets Проект,
 * Эксперт, Тема on the three Academy reads: the listing (`GET
 * /v1/public/events?timeframe=…`), the month entries (`?month=YYYY-MM`) and the
 * month counts (`/month-counts?year=YYYY`). The facets narrow all three the
 * same way, so the month view and the feed show one filtered set (row 51).
 *
 * The fixture taxonomy is unique to this suite (random slugs), so a facet read
 * selects exactly the fixture events and the sets can be asserted exactly. A
 * `doctors` event carries every fixture facet too: it must never appear or
 * count on an Academy read (012 LD-12).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "014 EARS-12 Academy facets on the listing, month and counts reads (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const eventIds: string[] = [];
    const linkRows: { table: string; id: string }[] = [];
    const taxonomyRows: { table: string; id: string }[] = [];

    let day = "";
    let month = "";
    let year = "";
    const tag = randomUUID().slice(0, 8);
    const projectSlug = `fx-project-${tag}`;
    const idleProjectSlug = `fx-idle-project-${tag}`;
    const expertSlug = `fx-expert-${tag}`;
    const topicSlug = `fx-topic-${tag}`;

    let projectId = "";
    let expertId = "";
    let topicId = "";

    let both = ""; // project + expert + topic
    let projectOnly = "";
    let expertOnly = "";
    let doctorsEvent = "";

    const link = async (
      table: "event_projects" | "event_experts" | "event_directions",
      eventId: string,
      refId: string,
    ) => {
      const id = randomUUID();
      if (table === "event_projects") {
        await pool.query(
          "INSERT INTO event_projects (id, event_id, project_id, status) VALUES ($1, $2, $3, 'active')",
          [id, eventId, refId],
        );
      } else if (table === "event_experts") {
        await pool.query(
          "INSERT INTO event_experts (id, event_id, expert_id, role, position, status) VALUES ($1, $2, $3, 'Спикер', 0, 'active')",
          [id, eventId, refId],
        );
      } else {
        await pool.query(
          "INSERT INTO event_directions (id, event_id, direction_id, status) VALUES ($1, $2, $3, 'active')",
          [id, eventId, refId],
        );
      }
      linkRows.push({ table, id });
    };

    const makeEvent = async (input: {
      title: string;
      hour: number;
      audience?: "doctors" | "experts";
      project?: boolean;
      expert?: boolean;
      topic?: boolean;
    }) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience)
         VALUES ($1, $2, $3, 'Школа фасетов', $4, 60, 'published', ${eventClassificationSql(input.audience ?? "experts")})`,
        [
          id,
          `facets-${randomUUID()}`,
          input.title,
          new Date(
            `${day}T${String(input.hour).padStart(2, "0")}:00:00+03:00`,
          ).toISOString(),
        ],
      );
      eventIds.push(id);
      if (input.project) await link("event_projects", id, projectId);
      if (input.expert) await link("event_experts", id, expertId);
      if (input.topic) await link("event_directions", id, topicId);
      return id;
    };

    const get = async (url: string) => {
      const response = await app.inject({ method: "GET", url });
      return response;
    };

    const listing = async (query: string) => {
      const response = await get(
        `/v1/public/events?timeframe=upcoming&from=${day}&to=${addDoctorEventsFeedDays(day, 1)}${query}`,
      );
      expect(response.statusCode).toBe(200);
      return PublicEventListingPageSchema.parse(response.json());
    };

    const monthIds = async (query: string) => {
      const response = await get(`/v1/public/events?month=${month}${query}`);
      expect(response.statusCode).toBe(200);
      return MonthBroadcastListSchema.parse(response.json()).map((e) => e.id);
    };

    const monthCount = async (query: string) => {
      const response = await get(
        `/v1/public/events/month-counts?year=${year}${query}`,
      );
      expect(response.statusCode).toBe(200);
      const counts = MonthlyEventCountsSchema.parse(response.json());
      return counts.find((row) => row.month === Number(month.slice(5)))!.count;
    };

    const sorted = (ids: string[]) => [...ids].sort();

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      day = addDoctorEventsFeedDays(doctorEventsFeedDayOf(new Date()), 3);
      month = doctorEventsMonthOf(day);
      year = month.slice(0, 4);

      const project = await pool.query<{ id: string }>(
        "INSERT INTO projects (slug, kind, title, description, default_audience, status, first_published_at) VALUES ($1, 'school', $2, 'Фасеты', 'experts', 'published', now()) RETURNING id",
        [projectSlug, `Проект ${tag}`],
      );
      projectId = project.rows[0]!.id;
      taxonomyRows.push({ table: "projects", id: projectId });
      const idle = await pool.query<{ id: string }>(
        "INSERT INTO projects (slug, kind, title, description, default_audience, status, first_published_at) VALUES ($1, 'school', $2, 'Фасеты', 'experts', 'published', now()) RETURNING id",
        [idleProjectSlug, `Пустой проект ${tag}`],
      );
      taxonomyRows.push({ table: "projects", id: idle.rows[0]!.id });
      const expert = await pool.query<{ id: string }>(
        "INSERT INTO experts (slug, family_name, given_name, status, first_published_at) VALUES ($1, 'Фасетова', $2, 'published', now()) RETURNING id",
        [expertSlug, `Анна ${tag}`],
      );
      expertId = expert.rows[0]!.id;
      taxonomyRows.push({ table: "experts", id: expertId });
      const topic = await pool.query<{ id: string }>(
        "INSERT INTO directions (slug, title, status, first_published_at) VALUES ($1, $2, 'published', now()) RETURNING id",
        [topicSlug, `Тема ${tag}`],
      );
      topicId = topic.rows[0]!.id;
      taxonomyRows.push({ table: "directions", id: topicId });

      both = await makeEvent({
        title: "Все три фасета",
        hour: 10,
        project: true,
        expert: true,
        topic: true,
      });
      projectOnly = await makeEvent({
        title: "Только проект",
        hour: 11,
        project: true,
      });
      expertOnly = await makeEvent({
        title: "Только эксперт",
        hour: 12,
        expert: true,
      });
      doctorsEvent = await makeEvent({
        title: "Событие врачей",
        hour: 13,
        audience: "doctors",
        project: true,
        expert: true,
        topic: true,
      });
    }, 60_000);

    afterAll(async () => {
      if (pool) {
        for (const row of linkRows) {
          await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
        }
        for (const id of eventIds) await deleteEventFixture(pool, id);
        for (const row of taxonomyRows) {
          await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
        }
      }
      await app?.close();
    });

    it("014 EARS-12: each facet narrows the listing to the events carrying it", async () => {
      expect(
        sorted(
          (await listing(`&project=${projectSlug}`)).data.map((c) => c.id),
        ),
      ).toEqual(sorted([both, projectOnly]));
      expect(
        sorted((await listing(`&expert=${expertSlug}`)).data.map((c) => c.id)),
      ).toEqual(sorted([both, expertOnly]));
      expect(
        (await listing(`&topic=${topicSlug}`)).data.map((c) => c.id),
      ).toEqual([both]);
    });

    it("014 EARS-12: facets AND together across the listing, month and counts reads", async () => {
      const query = `&project=${projectSlug}&expert=${expertSlug}`;
      expect((await listing(query)).data.map((c) => c.id)).toEqual([both]);
      expect(await monthIds(query)).toEqual([both]);
      expect(await monthCount(query)).toBe(1);
    });

    it("014 EARS-12: each facet narrows the month entries and the month counts alike (row 51)", async () => {
      for (const [query, expected] of [
        [`&project=${projectSlug}`, [both, projectOnly]],
        [`&expert=${expertSlug}`, [both, expertOnly]],
        [`&topic=${topicSlug}`, [both]],
      ] as const) {
        expect(sorted(await monthIds(query))).toEqual(sorted([...expected]));
        expect(await monthCount(query)).toBe(expected.length);
      }
    });

    it("014 EARS-12: a well-formed slug nothing carries reads empty, a malformed one is a 400", async () => {
      const unknown = `&project=fx-unknown-${randomUUID()}`;
      expect((await listing(unknown)).data).toEqual([]);
      expect(await monthIds(unknown)).toEqual([]);
      expect(await monthCount(unknown)).toBe(0);

      for (const url of [
        `/v1/public/events?timeframe=upcoming&project=${encodeURIComponent("Not A Slug")}`,
        `/v1/public/events?month=${month}&topic=${encodeURIComponent("Not A Slug")}`,
        `/v1/public/events/month-counts?year=${year}&expert=${encodeURIComponent("Not A Slug")}`,
      ]) {
        expect((await get(url)).statusCode).toBe(400);
      }
    });

    it("014 EARS-12: a doctors event never appears or counts on an Academy read (012 LD-12)", async () => {
      const query = `&project=${projectSlug}`;
      expect((await listing(query)).data.map((c) => c.id)).not.toContain(
        doctorsEvent,
      );
      expect(await monthIds(query)).not.toContain(doctorsEvent);
      expect(await monthCount(query)).toBe(2);
    });

    it("014 EARS-12: the listing lists each facet's options with counts under the other facets", async () => {
      const page = await listing(`&expert=${expertSlug}`);
      const facets = page.facets!;
      expect(facets).toBeDefined();

      // The expert's own count ignores its own selection: both of its events.
      expect(facets.expert.find((o) => o.slug === expertSlug)).toEqual({
        slug: expertSlug,
        title: `Фасетова Анна ${tag}`,
        count: 2,
      });
      // Project and topic count under `expert`: only the three-facet event.
      expect(facets.project.find((o) => o.slug === projectSlug)).toEqual({
        slug: projectSlug,
        title: `Проект ${tag}`,
        count: 1,
      });
      expect(facets.topic.find((o) => o.slug === topicSlug)).toEqual({
        slug: topicSlug,
        title: `Тема ${tag}`,
        count: 1,
      });
      // A project no Academy event carries is not an option at all.
      expect(facets.project.some((o) => o.slug === idleProjectSlug)).toBe(
        false,
      );
    });

    it("014 EARS-12: a zero-yield option stays listed with count 0", async () => {
      const page = await listing(`&topic=${topicSlug}`);
      // Under `topic`, the expert-only event drops, but the expert still has
      // the three-facet event; the project too. Narrow further by an unknown
      // topic: every option stays listed, at zero.
      expect(
        page.facets!.expert.find((o) => o.slug === expertSlug)?.count,
      ).toBe(1);
      const empty = await listing(`&topic=fx-unknown-${randomUUID()}`);
      expect(empty.facets!.project.find((o) => o.slug === projectSlug)).toEqual(
        { slug: projectSlug, title: `Проект ${tag}`, count: 0 },
      );
      expect(
        empty.facets!.expert.find((o) => o.slug === expertSlug)?.count,
      ).toBe(0);
    });
  },
);

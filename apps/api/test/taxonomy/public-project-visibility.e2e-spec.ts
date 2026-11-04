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
  PublicEventListingPageSchema,
  addDoctorEventsFeedDays,
  doctorEventsFeedDayOf,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";
import {
  deleteProjectResults,
  seedProjectResult,
} from "../setup/project-results.js";

/**
 * 030 EARS-17 — after the forward migration every project has no results, and
 * «a published project without results SHALL stay off every public read»: a
 * public project is published AND declares at least one result (030 EARS-8).
 *
 * One published project, linked to a public event, a published expert and a
 * published partner, starts with NO result. Every existing public read that
 * lists or keys a project must then behave as if it were not published —
 * partner→projects, expert→projects, event→projects and the Academy project
 * facet omit it, and the project-keyed reads answer 404 — and every one of
 * them must carry it once it holds one result.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "030 EARS-17 a published project without results stays off every public read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const tag = randomUUID().slice(0, 8);
    const projectSlug = `pv-project-${tag}`;
    const expertSlug = `pv-expert-${tag}`;
    const partnerSlug = `pv-partner-${tag}`;
    const eventSlug = `pv-event-${tag}`;
    let projectId = "";
    let expertId = "";
    let partnerId = "";
    let eventId = "";
    let day = "";
    const linkRows: { table: string; id: string }[] = [];

    const get = (url: string) => app.inject({ method: "GET", url });

    const ids = async (url: string): Promise<string[]> => {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      return (res.json() as { data: { id: string }[] }).data.map((r) => r.id);
    };

    const facetSlugs = async (): Promise<string[]> => {
      const res = await get(
        `/v1/public/events?timeframe=upcoming&from=${day}&to=${addDoctorEventsFeedDays(day, 1)}`,
      );
      expect(res.statusCode).toBe(200);
      const page = PublicEventListingPageSchema.parse(res.json());
      return page.facets!.project.map((o) => o.slug);
    };

    const listingReads = () => [
      `/v1/public/partners/${partnerSlug}/projects`,
      `/v1/public/experts/${expertSlug}/projects`,
      `/v1/public/events/${eventSlug}/projects`,
    ];
    const keyedReads = () => [
      `/v1/public/projects/${projectSlug}/events`,
      `/v1/public/projects/${projectSlug}/experts`,
      `/v1/public/projects/${projectSlug}/partners`,
    ];

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

      projectId = (
        await pool.query<{ id: string }>(
          `INSERT INTO projects (slug, stage, title, description, default_audience, status, first_published_at)
           VALUES ($1, 'running', $2, 'Без результатов', 'experts', 'published', now()) RETURNING id`,
          [projectSlug, `Проект ${tag}`],
        )
      ).rows[0]!.id;
      expertId = (
        await pool.query<{ id: string }>(
          `INSERT INTO experts (slug, family_name, given_name, status, first_published_at)
           VALUES ($1, 'Видимова', $2, 'published', now()) RETURNING id`,
          [expertSlug, `Анна ${tag}`],
        )
      ).rows[0]!.id;
      partnerId = (
        await pool.query<{ id: string }>(
          `INSERT INTO organisations (slug, title, status, first_published_at)
           VALUES ($1, $2, 'published', now()) RETURNING id`,
          [partnerSlug, `Партнёр ${tag}`],
        )
      ).rows[0]!.id;
      eventId = (
        await pool.query<{ id: string }>(
          `INSERT INTO events (slug, title, school, starts_at, duration_min, state, kind_id, audience)
           VALUES ($1, 'Эфир видимости', 'Школа', $2, 60, 'published', ${eventClassificationSql("experts")})
           RETURNING id`,
          [eventSlug, new Date(`${day}T10:00:00+03:00`).toISOString()],
        )
      ).rows[0]!.id;

      const link = async (sql: string, params: unknown[], table: string) => {
        const { rows } = await pool.query<{ id: string }>(sql, params);
        linkRows.push({ table, id: rows[0]!.id });
      };
      await link(
        "INSERT INTO event_projects (event_id, project_id, status) VALUES ($1, $2, 'active') RETURNING id",
        [eventId, projectId],
        "event_projects",
      );
      await link(
        "INSERT INTO project_experts (project_id, expert_id, role, status) VALUES ($1, $2, 'curator', 'active') RETURNING id",
        [projectId, expertId],
        "project_experts",
      );
      await link(
        `INSERT INTO project_organisations (project_id, organisation_id, is_primary, role_id)
         VALUES ($1, $2, true, '03200000-0000-4000-8000-000000000001') RETURNING id`,
        [projectId, partnerId],
        "project_organisations",
      );
    }, 60_000);

    afterAll(async () => {
      if (pool) {
        for (const row of linkRows) {
          await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
        }
        if (eventId) await deleteEventFixture(pool, eventId);
        if (projectId) {
          await deleteProjectResults(pool, [projectId]);
          await pool.query("DELETE FROM projects WHERE id = $1", [projectId]);
        }
        if (expertId)
          await pool.query("DELETE FROM experts WHERE id = $1", [expertId]);
        if (partnerId)
          await pool.query("DELETE FROM organisations WHERE id = $1", [
            partnerId,
          ]);
      }
      await app?.close();
    });

    it("EARS-17: when a published project declares no result, every public read that lists or keys it shall leave it out", async () => {
      for (const url of listingReads()) {
        expect(await ids(url), url).not.toContain(projectId);
      }
      for (const url of keyedReads()) {
        const res = await get(url);
        expect(res.statusCode, url).toBe(404);
      }
      expect(await facetSlugs()).not.toContain(projectSlug);
    });

    it("EARS-17: once the published project declares a result, every one of those reads shall carry it", async () => {
      await seedProjectResult(pool, projectId);

      for (const url of listingReads()) {
        expect(await ids(url), url).toContain(projectId);
      }
      expect(await ids(`/v1/public/projects/${projectSlug}/events`)).toContain(
        eventId,
      );
      expect(
        await ids(`/v1/public/projects/${projectSlug}/experts`),
      ).toContain(expertId);
      expect(
        await ids(`/v1/public/projects/${projectSlug}/partners`),
      ).toContain(partnerId);
      expect(await facetSlugs()).toContain(projectSlug);
    });
  },
);

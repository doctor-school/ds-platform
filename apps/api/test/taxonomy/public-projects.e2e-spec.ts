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
  PublicOrganisationCountSchema,
  PublicProjectCatalogSchema,
  PublicProjectResultListSchema,
  PublicProjectScaleSchema,
  PublicProjectSchema,
  PublicProjectSummarySchema,
  type PublicProjectScale,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";
import {
  deleteProjectResults,
  TEST_OUTPUT_KIND_ID,
} from "../setup/project-results.js";

/**
 * 030 EARS-8 / EARS-9 / EARS-13 (#3505) — the public project reads (V-6).
 *
 * Three public projects — "Ортобиология" (running), "Ревматология" (soon, with
 * its note) and "Кто стоит за брендом" (completed) — ordered by the operator
 * completed-first, so the catalog's stage grouping is what puts the completed
 * one last. Beside them: a published project WITHOUT results, a draft and a
 * retired one (each with a result) that every read must treat as absent.
 *
 * The suites run with `fileParallelism: false`, so the scale line is asserted
 * as the delta this fixture adds over a baseline read taken before seeding.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "030 public project reads — catalog, scale line, project and results (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let baseline: PublicProjectScale;

    const tag = randomUUID().slice(0, 8);
    // Slugs are ASCII (the `projects_slug_pattern` CHECK); titles stay Russian.
    const latin: Record<string, string> = {
      Ортобиология: "ortho",
      Ревматология: "rheuma",
      "Кто стоит за брендом": "brand",
      "Без результатов": "no-results",
      Черновик: "draft",
      Снятый: "retired",
      Кураторова: "curator",
      Участникова: "member",
      Черновикова: "draft-member",
    };
    const slug = (name: string) => `pp-${latin[name] ?? name}-${tag}`;
    const ids: Record<string, string> = {};
    const projectIds: string[] = [];
    const eventIds: string[] = [];
    const orgIds: string[] = [];
    const expertIds: string[] = [];
    const roleIds: string[] = [];
    const kindIds: string[] = [];
    const linkRows: { table: string; id: string }[] = [];

    const get = (url: string) => app.inject({ method: "GET", url });
    const one = async (
      sql: string,
      params: unknown[],
      bucket: string[],
    ): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(sql, params);
      bucket.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const link = async (sql: string, params: unknown[], table: string) => {
      const { rows } = await pool.query<{ id: string }>(sql, params);
      linkRows.push({ table, id: rows[0]!.id });
    };

    const project = (
      name: string,
      fields: {
        stage: "running" | "soon" | "completed";
        stageNote?: string;
        position: number;
        status?: "draft" | "published" | "retired";
        firstPublishedAt?: string | null;
      },
    ) =>
      one(
        `INSERT INTO projects
           (slug, stage, stage_note, title, description, cover_ref, default_audience,
            status, deleted_at, first_published_at, display_position)
         VALUES ($1, $2, $3, $4, $5, NULL, 'experts', $6::taxonomy_status,
                 CASE WHEN $6::taxonomy_status = 'retired' THEN now() END, $7, $8)
         RETURNING id`,
        [
          slug(name),
          fields.stage,
          fields.stageNote ?? null,
          `${name} ${tag}`,
          `О проекте ${name}`,
          fields.status ?? "published",
          fields.firstPublishedAt === undefined
            ? new Date().toISOString()
            : fields.firstPublishedAt,
          fields.position,
        ],
        projectIds,
      );

    const result = (
      projectId: string,
      position: number,
      kindId: string,
      title: string,
      storefrontUrl: string | null = null,
    ) =>
      pool.query(
        `INSERT INTO project_results (project_id, output_kind_id, position, title, description, storefront_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          projectId,
          kindId,
          position,
          title,
          `Описание ${title}`,
          storefrontUrl,
        ],
      );

    const event = (name: string, state: string, startsAt: string) =>
      one(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state, kind_id, audience)
         VALUES ($1, $2, 'Школа', $3, 60, $4, ${eventClassificationSql("experts")})
         RETURNING id`,
        [slug(name), `Эфир ${name}`, startsAt, state],
        eventIds,
      );

    const linkEvent = (eventId: string, projectId: string) =>
      link(
        "INSERT INTO event_projects (event_id, project_id, status) VALUES ($1, $2, 'active') RETURNING id",
        [eventId, projectId],
        "event_projects",
      );

    const scale = async (): Promise<PublicProjectScale> => {
      const res = await get("/v1/public/projects/scale");
      expect(res.statusCode).toBe(200);
      return PublicProjectScaleSchema.parse(res.json());
    };

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

      baseline = await scale();

      // Output kinds: the migration seed «Школа» and one suite-owned kind.
      const podcastKind = await one(
        "INSERT INTO project_output_kinds (slug, title) VALUES ($1, $2) RETURNING id",
        [slug("podcast"), `Подкаст ${tag}`],
        kindIds,
      );
      const clinicRole = await one(
        "INSERT INTO organisation_roles (slug, title) VALUES ($1, $2) RETURNING id",
        [slug("clinic"), `Клиническая площадка ${tag}`],
        roleIds,
      );
      const investorRole = "03200000-0000-4000-8000-000000000001";

      ids.ortho = await project("Ортобиология", {
        stage: "running",
        position: 1_000_002,
      });
      ids.rheuma = await project("Ревматология", {
        stage: "soon",
        stageNote: "идёт набор команды",
        position: 1_000_001,
      });
      ids.brand = await project("Кто стоит за брендом", {
        stage: "completed",
        position: 1_000_000,
        firstPublishedAt: "2023-05-01T09:00:00Z",
      });
      ids.noResults = await project("Без результатов", {
        stage: "running",
        position: 1_000_003,
      });
      ids.draft = await project("Черновик", {
        stage: "running",
        position: 1_000_004,
        status: "draft",
        firstPublishedAt: null,
      });
      ids.retired = await project("Снятый", {
        stage: "running",
        position: 1_000_005,
        status: "retired",
      });

      await result(
        ids.ortho,
        0,
        TEST_OUTPUT_KIND_ID,
        "Школа ортобиологии",
        "https://doctor.school/schools/ortho",
      );
      await result(ids.ortho, 1, podcastKind, "Подкаст об ортобиологии");
      await result(ids.ortho, 2, TEST_OUTPUT_KIND_ID, "Вторая школа");
      await result(ids.rheuma, 0, podcastKind, "Подкаст о ревматологии");
      await result(ids.brand, 0, TEST_OUTPUT_KIND_ID, "Школа бренда");
      await result(ids.draft, 0, TEST_OUTPUT_KIND_ID, "Итог черновика");
      await result(ids.retired, 0, TEST_OUTPUT_KIND_ID, "Итог снятого");

      // Organisations: a logo-hidden investor, a name-hidden investor, a site.
      const org = (name: string, nameVisible: boolean, logoVisible: boolean) =>
        one(
          `INSERT INTO organisations (slug, title, status, first_published_at, logo_ref, public_name_visible, public_logo_visible)
           VALUES ($1, $2, 'published', now(), $3, $4, $5) RETURNING id`,
          [
            slug(name),
            `${name} ${tag}`,
            `organisations/${tag}/${name}.webp`,
            nameVisible,
            logoVisible,
          ],
          orgIds,
        );
      ids.farma = await org("pharma", true, false);
      ids.hidden = await org("hidden", false, true);
      ids.cito = await org("cito", true, true);

      const partnerLink = (
        projectId: string,
        orgId: string,
        isPrimary: boolean,
        roleId: string,
        note: string | null,
      ) =>
        link(
          `INSERT INTO project_organisations (project_id, organisation_id, is_primary, role_id, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [projectId, orgId, isPrimary, roleId, note],
          "project_organisations",
        );
      await partnerLink(ids.ortho, ids.farma, true, investorRole, null);
      await partnerLink(
        ids.ortho,
        ids.cito,
        false,
        clinicRole,
        "база исследований",
      );
      await partnerLink(ids.rheuma, ids.hidden, true, investorRole, null);

      // Experts: the curator, a published member, a draft member (not counted).
      const expert = (name: string, status: "draft" | "published") =>
        one(
          `INSERT INTO experts (slug, family_name, given_name, patronymic, status, first_published_at)
           VALUES ($1, $2, 'Анна', 'Сергеевна', $3::taxonomy_status,
                   CASE WHEN $3::taxonomy_status = 'published' THEN now() END) RETURNING id`,
          [slug(name), `${name}${tag}`, status],
          expertIds,
        );
      ids.curator = await expert("Кураторова", "published");
      ids.member = await expert("Участникова", "published");
      ids.draftMember = await expert("Черновикова", "draft");
      const expertLink = (expertId: string, role: "curator" | "member") =>
        link(
          "INSERT INTO project_experts (project_id, expert_id, role, status) VALUES ($1, $2, $3, 'active') RETURNING id",
          [ids.ortho, expertId, role],
          "project_experts",
        );
      await expertLink(ids.curator, "curator");
      await expertLink(ids.member, "member");
      await expertLink(ids.draftMember, "member");

      // Events: two public ones linked to public projects (one shared by two
      // projects — counted once), a draft one and one under a non-public project.
      ids.e2024 = await event("e2024", "published", "2024-03-01T10:00:00Z");
      ids.e2025 = await event("e2025", "ended", "2025-02-01T10:00:00Z");
      ids.eDraft = await event("edraft", "draft", "2019-01-10T10:00:00Z");
      ids.eHidden = await event("ehidden", "published", "2018-01-10T10:00:00Z");
      await linkEvent(ids.e2024, ids.ortho);
      await linkEvent(ids.e2025, ids.ortho);
      await linkEvent(ids.e2025, ids.rheuma);
      await linkEvent(ids.eDraft, ids.ortho);
      await linkEvent(ids.eHidden, ids.noResults);
    }, 60_000);

    afterAll(async () => {
      if (pool) {
        for (const row of linkRows) {
          await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
        }
        for (const id of eventIds) await deleteEventFixture(pool, id);
        await deleteProjectResults(pool, projectIds);
        await pool.query("DELETE FROM projects WHERE id = ANY($1)", [
          projectIds,
        ]);
        await pool.query(
          "DELETE FROM project_output_kinds WHERE id = ANY($1)",
          [kindIds],
        );
        await pool.query("DELETE FROM experts WHERE id = ANY($1)", [expertIds]);
        await pool.query("DELETE FROM organisations WHERE id = ANY($1)", [
          orgIds,
        ]);
        await pool.query("DELETE FROM organisation_roles WHERE id = ANY($1)", [
          roleIds,
        ]);
      }
      await app?.close();
    });

    const catalogMine = async () => {
      const res = await get("/v1/public/projects");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Record<string, unknown>[] };
      for (const item of body.data) expect(item).not.toHaveProperty("kind");
      const catalog = PublicProjectCatalogSchema.parse(body);
      return catalog.data.filter((item) => item.slug.endsWith(`-${tag}`));
    };

    it("EARS-8: the catalog shall list the running and soon projects in the operator's order, then the completed ones, with no kind", async () => {
      const mine = await catalogMine();
      expect(mine.map((item) => item.slug)).toEqual([
        slug("Ревматология"),
        slug("Ортобиология"),
        slug("Кто стоит за брендом"),
      ]);
      const [rheuma, ortho, brand] = mine;
      expect(rheuma).toMatchObject({
        title: `Ревматология ${tag}`,
        description: "О проекте Ревматология",
        coverUrl: null,
        stage: "soon",
        stageNote: "идёт набор команды",
      });
      expect(ortho).toMatchObject({ stage: "running", stageNote: null });
      expect(brand).toMatchObject({ stage: "completed", investor: null });
    });

    it("EARS-8: the outputs shall be the titles of the distinct kinds of the results, in result order", async () => {
      const [rheuma, ortho] = await catalogMine();
      const school = (
        await pool.query<{ title: string }>(
          "SELECT title FROM project_output_kinds WHERE id = $1",
          [TEST_OUTPUT_KIND_ID],
        )
      ).rows[0]!.title;
      expect(ortho!.outputs).toEqual([school, `Подкаст ${tag}`]);
      expect(rheuma!.outputs).toEqual([`Подкаст ${tag}`]);
    });

    it("EARS-8: a name-hidden investor shall be absent and a logo-hidden one shall carry logoUrl null", async () => {
      const [rheuma, ortho] = await catalogMine();
      expect(ortho!.investor).toEqual({
        title: `pharma ${tag}`,
        logoUrl: null,
      });
      expect(rheuma!.investor).toBeNull();
      expect(JSON.stringify(rheuma)).not.toContain(`hidden ${tag}`);
    });

    it("EARS-8: a published project without results, a draft and a retired project shall be absent from the catalog", async () => {
      const slugs = (await catalogMine()).map((item) => item.slug);
      for (const name of ["Без результатов", "Черновик", "Снятый"]) {
        expect(slugs).not.toContain(slug(name));
      }
    });

    it("EARS-8: the project summaries embedded in the relationship reads shall carry the stage and no kind", async () => {
      const res = await get(`/v1/public/events/${slug("e2024")}/projects`);
      expect(res.statusCode).toBe(200);
      const [item] = (res.json() as { data: Record<string, unknown>[] }).data;
      expect(item).not.toHaveProperty("kind");
      const { isPrimary: _isPrimary, ...summary } = item as Record<
        string,
        unknown
      >;
      expect(PublicProjectSummarySchema.parse(summary)).toMatchObject({
        id: ids.ortho,
        stage: "running",
      });
    });

    it("EARS-9: the scale line shall count public projects, the 032 published organisations, public events of public projects and their first year", async () => {
      const now = await scale();
      expect(now.projects - baseline.projects).toBe(3);
      expect(now.broadcasts - baseline.broadcasts).toBe(2);
      expect(now.firstBroadcastYear).toBe(
        baseline.firstBroadcastYear === null
          ? 2024
          : Math.min(baseline.firstBroadcastYear, 2024),
      );
      expect(now.partners - baseline.partners).toBe(3);
    });

    it("EARS-9: the scale-line partners figure shall equal the 032 EARS-12 count for the same data", async () => {
      const count = PublicOrganisationCountSchema.parse(
        (await get("/v1/public/organisations/count")).json(),
      );
      expect((await scale()).partners).toBe(count.count);
    });

    it("EARS-13: the project read shall answer the hero fields, the curator's name only, the counts, the since-year and the projected organisations", async () => {
      const investorRoleTitle = (
        await pool.query<{ title: string }>(
          "SELECT title FROM organisation_roles WHERE id = '03200000-0000-4000-8000-000000000001'",
        )
      ).rows[0]!.title;
      for (const key of [slug("Ортобиология"), ids.ortho!]) {
        const res = await get(`/v1/public/projects/${key}`);
        expect(res.statusCode, key).toBe(200);
        const body = PublicProjectSchema.parse(res.json());
        expect(body).toEqual({
          slug: slug("Ортобиология"),
          title: `Ортобиология ${tag}`,
          description: "О проекте Ортобиология",
          coverUrl: null,
          stage: "running",
          stageNote: null,
          curatorName: `Кураторова${tag} Анна Сергеевна`,
          resultCount: 3,
          expertCount: 2,
          sinceYear: 2024,
          organisations: [
            {
              title: `pharma ${tag}`,
              logoUrl: null,
              roleTitle: investorRoleTitle,
              note: null,
              isInvestor: true,
            },
            {
              title: `cito ${tag}`,
              logoUrl: expect.any(String),
              roleTitle: `Клиническая площадка ${tag}`,
              note: "база исследований",
              isInvestor: false,
            },
          ],
          investorPlaceOpen: false,
        });
      }
    });

    it("EARS-13: a name-hidden investor shall close the investor place without being disclosed", async () => {
      const res = await get(`/v1/public/projects/${slug("Ревматология")}`);
      expect(res.statusCode).toBe(200);
      const body = PublicProjectSchema.parse(res.json());
      expect(body.organisations).toEqual([]);
      expect(body.investorPlaceOpen).toBe(false);
      expect(body.curatorName).toBeNull();
      expect(body.sinceYear).toBe(2025);
    });

    it("EARS-13: a project with no investor link shall open the place and take its since-year from the first publish", async () => {
      const body = PublicProjectSchema.parse(
        (
          await get(`/v1/public/projects/${slug("Кто стоит за брендом")}`)
        ).json(),
      );
      expect(body.investorPlaceOpen).toBe(true);
      expect(body.sinceYear).toBe(2023);
      expect(body.stage).toBe("completed");
    });

    it("EARS-13: the results read shall answer the results in order with kind title, title, description and storefront link", async () => {
      const res = await get(
        `/v1/public/projects/${slug("Ортобиология")}/results`,
      );
      expect(res.statusCode).toBe(200);
      const body = PublicProjectResultListSchema.parse(res.json());
      expect(body.data.map((r) => r.title)).toEqual([
        "Школа ортобиологии",
        "Подкаст об ортобиологии",
        "Вторая школа",
      ]);
      expect(body.data[0]).toMatchObject({
        description: "Описание Школа ортобиологии",
        storefrontUrl: "https://doctor.school/schools/ortho",
      });
      expect(body.data[1]).toMatchObject({
        kindTitle: `Подкаст ${tag}`,
        storefrontUrl: null,
      });
      for (const row of body.data) expect(row).not.toHaveProperty("id");
    });

    it("EARS-13: a draft, retired, non-public or unknown project shall be answered 404 alike", async () => {
      const keys = [
        slug("Черновик"),
        slug("Снятый"),
        slug("Без результатов"),
        ids.draft!,
        `pp-unknown-${tag}`,
        randomUUID(),
      ];
      const bodies = new Set<string>();
      for (const key of keys) {
        for (const suffix of ["", "/results"]) {
          const res = await get(`/v1/public/projects/${key}${suffix}`);
          expect(res.statusCode, `${key}${suffix}`).toBe(404);
          // `instance` and `traceId` are the two per-request problem fields.
          const {
            instance: _instance,
            traceId: _traceId,
            ...problem
          } = res.json() as Record<string, unknown>;
          bodies.add(JSON.stringify(problem));
        }
      }
      expect(bodies.size).toBe(1);
    });
  },
);

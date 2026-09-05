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

// 012 EARS-12 (#1294) — the CROSS-route public-read contract sweep.
//
// Each relationship vertical already owns a per-route e2e suite (#1289, #1291,
// #1292, #1293) that proves ITS route. What no suite proves is the invariant
// EARS-12 actually states: that all eight shipped relationship directions answer
// with the SAME envelope, the SAME 404 body, the SAME allow-list at every hop
// and cursors that are opaque per route — properties a reader can only observe
// by holding the eight routes side by side against ONE seeded graph.
//
// So this suite seeds exactly one graph and drives all eight routes from a
// table. A regression that gives one route its own private mapper, its own
// pagination envelope, its own «not found» body or a cursor that survives being
// replayed on a differently-ordered route fails HERE and nowhere else.
//
// Scope is the eight SHIPPED relationship routes plus the one-resolver speaker
// order (owner decision 2026-09-05 on #1294: «Только сводка по 8 маршрутам»).
// `/events/:key/experts`, `/experts/:key/events` and the base list/detail
// collections are #1880 and are deliberately NOT swept here.
//
// Zero-auth throughout: every route under test is `@Public()`, so the suite
// never establishes an admin session — the graph is authored straight into
// Postgres, which is also what keeps the eligible/ineligible lifecycle matrix
// (draft, retired, retired-join) expressible in one place.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-12 cross-route public-read contract (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();

    // Cleanup ledgers — joins are torn down before their endpoints because every
    // 012 FK is RESTRICT by design.
    const createdJoins: Record<string, string[]> = {
      event_experts: [],
      event_projects: [],
      event_directions: [],
      project_experts: [],
      project_partners: [],
    };
    const createdEntities: Record<string, string[]> = {
      events: [],
      projects: [],
      experts: [],
      partners: [],
      directions: [],
    };

    // ── Row authoring ──────────────────────────────────────────────────────

    async function insert(
      table: string,
      row: Record<string, unknown>,
      ledger: string[],
    ): Promise<string> {
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      const id = rows[0]!.id;
      ledger.push(id);
      return id;
    }

    /** `published` (default), `draft` or `retired` — the three lifecycles §5.2 discriminates. */
    type Lifecycle = "published" | "draft" | "retired";

    function lifecycleColumns(status: Lifecycle): Record<string, unknown> {
      if (status === "draft") {
        return { status: "draft", first_published_at: null, deleted_at: null };
      }
      if (status === "retired") {
        // `<entity>_retired_iff_deleted` — a retired row ALWAYS carries its
        // tombstone instant, and it was published before it was retired.
        return {
          status: "retired",
          first_published_at: new Date(),
          deleted_at: new Date(),
        };
      }
      return {
        status: "published",
        first_published_at: new Date(),
        deleted_at: null,
      };
    }

    /**
     * A publicly visible event by default. `state` rather than `status`: events
     * are feature-004 rows, and `PUBLIC_EVENT_STATES` is `published | live |
     * ended`. There is no `retired` event state, so the event-sourced routes
     * express their ineligible source as a DRAFT event (see the 404 matrix).
     *
     * `starts_at` is deliberately written by POSTGRES (`now() + interval …`)
     * rather than by a JavaScript `Date`: the column keeps MICROSECONDS, and the
     * event-ordered cursor has to survive that. A seed that pre-rounded the
     * instant to milliseconds would hide the exact defect 12.1 exists to catch.
     */
    async function insertEvent(
      title: string,
      state: "published" | "draft" = "published",
      startsAtSql = "now() + interval '7 days'",
    ): Promise<{ id: string; slug: string }> {
      const slug = `e-1294-${randomUUID()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, $2, 'Кардиология', ${startsAtSql}, 90, $3) RETURNING id`,
        [slug, title, state],
      );
      createdEntities.events.push(rows[0]!.id);
      return { id: rows[0]!.id, slug };
    }

    function insertProject(
      title: string,
      status: Lifecycle = "published",
    ): Promise<string> {
      return insert(
        "projects",
        {
          slug: `p-1294-${randomUUID()}`,
          kind: "school",
          title,
          description: "Описание проекта",
          ...lifecycleColumns(status),
        },
        createdEntities.projects!,
      );
    }

    function insertExpert(
      familyName: string,
      status: Lifecycle = "published",
    ): Promise<string> {
      return insert(
        "experts",
        {
          slug: `x-1294-${randomUUID()}`,
          family_name: familyName,
          given_name: "И. И.",
          professional_role: "Кардиолог",
          credentials: "д.м.н.",
          affiliation: "НМИЦ",
          ...lifecycleColumns(status),
        },
        createdEntities.experts!,
      );
    }

    function insertPartner(
      title: string,
      status: Lifecycle = "published",
    ): Promise<string> {
      return insert(
        "partners",
        {
          slug: `pt-1294-${randomUUID()}`,
          title,
          website_url: "https://partner.example",
          ...lifecycleColumns(status),
        },
        createdEntities.partners!,
      );
    }

    function insertDirection(
      title: string,
      status: Lifecycle = "published",
    ): Promise<string> {
      return insert(
        "directions",
        {
          slug: `d-1294-${randomUUID()}`,
          title,
          ...lifecycleColumns(status),
        },
        createdEntities.directions!,
      );
    }

    /** An `active` join unless `retired`, which carries its tombstone instant. */
    function joinState(retired: boolean): Record<string, unknown> {
      return retired
        ? { status: "retired", deleted_at: new Date() }
        : { status: "active", deleted_at: null };
    }

    function linkEventProject(
      eventId: string,
      projectId: string,
      retired = false,
    ): Promise<string> {
      return insert(
        "event_projects",
        { event_id: eventId, project_id: projectId, ...joinState(retired) },
        createdJoins.event_projects!,
      );
    }

    function linkEventDirection(
      eventId: string,
      directionId: string,
      retired = false,
    ): Promise<string> {
      return insert(
        "event_directions",
        { event_id: eventId, direction_id: directionId, ...joinState(retired) },
        createdJoins.event_directions!,
      );
    }

    function linkProjectExpert(
      projectId: string,
      expertId: string,
      role: "curator" | "member",
      retired = false,
    ): Promise<string> {
      return insert(
        "project_experts",
        {
          project_id: projectId,
          expert_id: expertId,
          role,
          ...joinState(retired),
        },
        createdJoins.project_experts!,
      );
    }

    function linkProjectPartner(
      projectId: string,
      partnerId: string,
      isPrimary: boolean,
      retired = false,
    ): Promise<string> {
      return insert(
        "project_partners",
        {
          project_id: projectId,
          partner_id: partnerId,
          is_primary: isPrimary,
          ...joinState(retired),
        },
        createdJoins.project_partners!,
      );
    }

    function linkEventExpert(
      eventId: string,
      expertId: string,
      position: number,
    ): Promise<string> {
      return insert(
        "event_experts",
        {
          event_id: eventId,
          expert_id: expertId,
          role: "Спикер",
          position,
          status: "active",
        },
        createdJoins.event_experts!,
      );
    }

    // ── The one seeded graph ───────────────────────────────────────────────

    interface Graph {
      e1: { id: string; slug: string };
      e2: { id: string; slug: string };
      eDraft: { id: string; slug: string };
      /** Published, but every one of its joins is retired → its forward reads are empty. */
      eJoinRetired: { id: string; slug: string };
      p1: string;
      p2: string;
      pDraft: string;
      pRetired: string;
      pJoinRetired: string;
      /** Published; its only active primary partner is a DRAFT organization. */
      pNoPrimary: string;
      x1: string;
      x2: string;
      xDraft: string;
      xRetired: string;
      xJoinRetired: string;
      t1: string;
      t2: string;
      tDraft: string;
      tRetired: string;
      tJoinRetired: string;
      d1: string;
      d2: string;
      dDraft: string;
      dRetired: string;
      dJoinRetired: string;
    }

    /**
     * ONE graph, shaped so that every route under test has EXACTLY TWO eligible
     * items (which makes `limit=1` a real two-page traversal on all eight) and,
     * on the same source, one draft endpoint, one retired endpoint and one
     * retired join that must all be invisible.
     */
    async function seedGraph(): Promise<Graph> {
      const [e1, e2, eDraft, eJoinRetired] = await Promise.all([
        insertEvent("Эфир А 1294"),
        insertEvent("Эфир Б 1294", "published", "now() + interval '14 days'"),
        insertEvent("Черновик 1294", "draft"),
        insertEvent("Только ретайр 1294"),
      ]);
      const [p1, p2, pDraft, pRetired, pJoinRetired, pNoPrimary] =
        await Promise.all([
          insertProject("Проект А 1294"),
          insertProject("Проект Б 1294"),
          insertProject("Проект черновик 1294", "draft"),
          insertProject("Проект ретайр 1294", "retired"),
          insertProject("Проект без активных связей 1294"),
          insertProject("Проект без главного партнёра 1294"),
        ]);
      const [x1, x2, xDraft, xRetired, xJoinRetired] = await Promise.all([
        insertExpert("Алексеева"),
        insertExpert("Борисова"),
        insertExpert("Черновикова", "draft"),
        insertExpert("Ретайрова", "retired"),
        insertExpert("Безсвязева"),
      ]);
      const [t1, t2, tDraft, tRetired, tJoinRetired] = await Promise.all([
        insertPartner("Альфа-Фарм 1294"),
        insertPartner("Бета-Фарм 1294"),
        insertPartner("Черновик-Фарм 1294", "draft"),
        insertPartner("Ретайр-Фарм 1294", "retired"),
        insertPartner("Безсвязь-Фарм 1294"),
      ]);
      const [d1, d2, dDraft, dRetired, dJoinRetired] = await Promise.all([
        insertDirection("Кардиология 1294"),
        insertDirection("Неврология 1294"),
        insertDirection("Черновик 1294", "draft"),
        insertDirection("Ретайр 1294", "retired"),
        insertDirection("Без связей 1294"),
      ]);

      await Promise.all([
        // event↔project: forward e1 → [p1, p2]; reverse p1 → [e1, e2].
        linkEventProject(e1.id, p1),
        linkEventProject(e1.id, p2),
        linkEventProject(e2.id, p1),
        linkEventProject(e1.id, pDraft),
        linkEventProject(e1.id, pRetired),
        linkEventProject(e1.id, pJoinRetired, true),
        linkEventProject(eDraft.id, p1),
        linkEventProject(eJoinRetired.id, p1, true),

        // event↔direction: forward e1 → [d1, d2]; reverse d1 → [e1, e2].
        linkEventDirection(e1.id, d1),
        linkEventDirection(e1.id, d2),
        linkEventDirection(e2.id, d1),
        linkEventDirection(e1.id, dDraft),
        linkEventDirection(e1.id, dRetired),
        linkEventDirection(e1.id, dJoinRetired, true),
        linkEventDirection(eDraft.id, d1),
        linkEventDirection(eJoinRetired.id, d1, true),

        // project↔expert: forward p1 → [x1 curator, x2 member]; reverse x1 → [p1, p2].
        linkProjectExpert(p1, x1, "curator"),
        linkProjectExpert(p1, x2, "member"),
        linkProjectExpert(p2, x1, "member"),
        linkProjectExpert(p1, xDraft, "member"),
        linkProjectExpert(p1, xRetired, "member"),
        linkProjectExpert(p1, xJoinRetired, "member", true),
        linkProjectExpert(pDraft, x1, "member"),
        linkProjectExpert(pRetired, x1, "member"),
        linkProjectExpert(pJoinRetired, x1, "member", true),

        // project↔partner: forward p1 → [t1 primary, t2]; reverse t1 → [p1, p2].
        linkProjectPartner(p1, t1, true),
        linkProjectPartner(p1, t2, false),
        linkProjectPartner(p2, t1, false),
        linkProjectPartner(p1, tDraft, false),
        linkProjectPartner(p1, tRetired, false),
        linkProjectPartner(p1, tJoinRetired, false, true),
        linkProjectPartner(pDraft, t1, false),
        linkProjectPartner(pRetired, t1, false),
        linkProjectPartner(pJoinRetired, t1, false, true),
        // The draft-primary case: `primaryPartner` must be null, never a leak.
        linkProjectPartner(pNoPrimary, tDraft, true),
        linkProjectPartner(pNoPrimary, t2, false),
      ]);

      return {
        e1,
        e2,
        eDraft,
        eJoinRetired,
        p1,
        p2,
        pDraft,
        pRetired,
        pJoinRetired,
        pNoPrimary,
        x1,
        x2,
        xDraft,
        xRetired,
        xJoinRetired,
        t1,
        t2,
        tDraft,
        tRetired,
        tJoinRetired,
        d1,
        d2,
        dDraft,
        dRetired,
        dJoinRetired,
      };
    }

    // ── The eight-route table ──────────────────────────────────────────────

    const PROJECT_SUMMARY_KEYS = [
      "coverUrl",
      "description",
      "id",
      "kind",
      "primaryPartner",
      "slug",
      "title",
    ];
    const EVENT_SUMMARY_KEYS = [
      "id",
      "school",
      "slug",
      "startsAt",
      "state",
      "title",
    ];
    const EXPERT_SUMMARY_KEYS = [
      "affiliation",
      "credentials",
      "id",
      "name",
      "photoUrl",
      "professionalRole",
      "slug",
    ];
    const PARTNER_SUMMARY_KEYS = [
      "id",
      "logoUrl",
      "slug",
      "title",
      "websiteUrl",
    ];

    function sorted(keys: string[]): string[] {
      return [...keys].sort();
    }

    interface RouteCase {
      /** Reads as the §5.2 direction name, so a failure names the route. */
      name: string;
      /** The relationship collection of the ELIGIBLE source. */
      url: (g: Graph) => string;
      /** Exactly the ids §5.2 allows through, in no particular order. */
      expected: (g: Graph) => string[];
      /** Ids the allow-list must hide on this direction. */
      hidden: (g: Graph) => string[];
      /** The exact sorted key set of one item. */
      keys: string[];
      /** Eligible source whose every relation is retired → a terminal empty page. */
      empty: (g: Graph) => string;
      /** Sources that are unknown, draft or retired → an identical 404. */
      ineligible: (g: Graph) => string[];
    }

    const ROUTES: RouteCase[] = [
      {
        name: "event→projects",
        url: (g) => `/v1/public/events/${g.e1.id}/projects`,
        expected: (g) => [g.p1, g.p2],
        hidden: (g) => [g.pDraft, g.pRetired, g.pJoinRetired],
        keys: sorted(PROJECT_SUMMARY_KEYS),
        empty: (g) => `/v1/public/events/${g.eJoinRetired.id}/projects`,
        ineligible: (g) => [
          `/v1/public/events/${randomUUID()}/projects`,
          `/v1/public/events/no-such-event-1294/projects`,
          `/v1/public/events/${g.eDraft.id}/projects`,
          `/v1/public/events/${g.eDraft.slug}/projects`,
        ],
      },
      {
        name: "project→events",
        url: (g) => `/v1/public/projects/${g.p1}/events`,
        expected: (g) => [g.e1.id, g.e2.id],
        hidden: (g) => [g.eDraft.id, g.eJoinRetired.id],
        keys: sorted(EVENT_SUMMARY_KEYS),
        empty: (g) => `/v1/public/projects/${g.pJoinRetired}/events`,
        ineligible: (g) => [
          `/v1/public/projects/${randomUUID()}/events`,
          `/v1/public/projects/no-such-project-1294/events`,
          `/v1/public/projects/${g.pDraft}/events`,
          `/v1/public/projects/${g.pRetired}/events`,
        ],
      },
      {
        name: "project→experts",
        url: (g) => `/v1/public/projects/${g.p1}/experts`,
        expected: (g) => [g.x1, g.x2],
        hidden: (g) => [g.xDraft, g.xRetired, g.xJoinRetired],
        keys: sorted([...EXPERT_SUMMARY_KEYS, "role"]),
        empty: (g) => `/v1/public/projects/${g.pJoinRetired}/experts`,
        ineligible: (g) => [
          `/v1/public/projects/${randomUUID()}/experts`,
          `/v1/public/projects/no-such-project-1294/experts`,
          `/v1/public/projects/${g.pDraft}/experts`,
          `/v1/public/projects/${g.pRetired}/experts`,
        ],
      },
      {
        name: "expert→projects",
        url: (g) => `/v1/public/experts/${g.x1}/projects`,
        expected: (g) => [g.p1, g.p2],
        hidden: (g) => [g.pDraft, g.pRetired, g.pJoinRetired],
        keys: sorted([...PROJECT_SUMMARY_KEYS, "role"]),
        empty: (g) => `/v1/public/experts/${g.xJoinRetired}/projects`,
        ineligible: (g) => [
          `/v1/public/experts/${randomUUID()}/projects`,
          `/v1/public/experts/no-such-expert-1294/projects`,
          `/v1/public/experts/${g.xDraft}/projects`,
          `/v1/public/experts/${g.xRetired}/projects`,
        ],
      },
      {
        name: "project→partners",
        url: (g) => `/v1/public/projects/${g.p1}/partners`,
        expected: (g) => [g.t1, g.t2],
        hidden: (g) => [g.tDraft, g.tRetired, g.tJoinRetired],
        keys: sorted([...PARTNER_SUMMARY_KEYS, "isPrimary"]),
        empty: (g) => `/v1/public/projects/${g.pJoinRetired}/partners`,
        ineligible: (g) => [
          `/v1/public/projects/${randomUUID()}/partners`,
          `/v1/public/projects/no-such-project-1294/partners`,
          `/v1/public/projects/${g.pDraft}/partners`,
          `/v1/public/projects/${g.pRetired}/partners`,
        ],
      },
      {
        name: "partner→projects",
        url: (g) => `/v1/public/partners/${g.t1}/projects`,
        expected: (g) => [g.p1, g.p2],
        hidden: (g) => [g.pDraft, g.pRetired, g.pJoinRetired],
        keys: sorted([...PROJECT_SUMMARY_KEYS, "isPrimary"]),
        empty: (g) => `/v1/public/partners/${g.tJoinRetired}/projects`,
        ineligible: (g) => [
          `/v1/public/partners/${randomUUID()}/projects`,
          `/v1/public/partners/no-such-partner-1294/projects`,
          `/v1/public/partners/${g.tDraft}/projects`,
          `/v1/public/partners/${g.tRetired}/projects`,
        ],
      },
      {
        name: "event→directions",
        url: (g) => `/v1/public/events/${g.e1.id}/directions`,
        expected: (g) => [g.d1, g.d2],
        hidden: (g) => [g.dDraft, g.dRetired, g.dJoinRetired],
        keys: sorted(["id", "slug", "title"]),
        empty: (g) => `/v1/public/events/${g.eJoinRetired.id}/directions`,
        ineligible: (g) => [
          `/v1/public/events/${randomUUID()}/directions`,
          `/v1/public/events/no-such-event-1294/directions`,
          `/v1/public/events/${g.eDraft.id}/directions`,
          `/v1/public/events/${g.eDraft.slug}/directions`,
        ],
      },
      {
        name: "direction→events",
        url: (g) => `/v1/public/directions/${g.d1}/events`,
        expected: (g) => [g.e1.id, g.e2.id],
        hidden: (g) => [g.eDraft.id, g.eJoinRetired.id],
        keys: sorted(EVENT_SUMMARY_KEYS),
        empty: (g) => `/v1/public/directions/${g.dJoinRetired}/events`,
        ineligible: (g) => [
          `/v1/public/directions/${randomUUID()}/events`,
          `/v1/public/directions/no-such-direction-1294/events`,
          `/v1/public/directions/${g.dDraft}/events`,
          `/v1/public/directions/${g.dRetired}/events`,
        ],
      },
    ];

    // ── Request helpers ────────────────────────────────────────────────────

    interface Page {
      data: Array<Record<string, unknown>>;
      pagination: { nextCursor: string | null; hasMore: boolean };
    }

    function publicGet(url: string) {
      return app.inject({ method: "GET", url });
    }

    function page(res: { payload: string }): Page {
      return JSON.parse(res.payload) as Page;
    }

    async function readPage(url: string): Promise<Page> {
      const res = await publicGet(url);
      expect(res.statusCode, `${url} → ${res.payload}`).toBe(200);
      return page(res);
    }

    /** Walk the whole traversal at `limit`, returning every id in page order. */
    async function drain(base: string, limit: number): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let hop = 0; hop < 10; hop += 1) {
        const query =
          cursor === null
            ? `?limit=${limit}`
            : `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
        const body = await readPage(`${base}${query}`);
        ids.push(...body.data.map((item) => String(item.id)));
        if (body.pagination.nextCursor === null) {
          expect(body.pagination.hasMore, `${base} terminal page`).toBe(false);
          return ids;
        }
        expect(body.pagination.hasMore, `${base} non-terminal page`).toBe(true);
        cursor = body.pagination.nextCursor;
      }
      throw new Error(`${base} did not terminate within 10 pages`);
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
      for (const [table, ids] of Object.entries(createdJoins)) {
        const batch = ids.splice(0);
        if (batch.length > 0) {
          await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [
            batch,
          ]);
        }
      }
      for (const [table, ids] of Object.entries(createdEntities)) {
        const batch = ids.splice(0);
        if (batch.length > 0) {
          await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [
            batch,
          ]);
        }
      }
    });

    afterAll(async () => {
      await app.close();
    });

    // ── 12.1 One envelope, one bounded page size, one opaque cursor ────────

    it("012 EARS-12.1: when a public caller pages any of the eight relationship directions with a bounded limit, the system shall return the same { data, pagination } envelope, terminate, and yield each authored pair exactly once", async () => {
      const graph = await seedGraph();

      for (const route of ROUTES) {
        const base = route.url(graph);
        const first = await readPage(`${base}?limit=1`);

        // Page one of a two-item traversal: bounded, non-terminal, with a
        // cursor the caller did not have to construct.
        expect(first.data, `${route.name} page size`).toHaveLength(1);
        expect(first.pagination.hasMore, `${route.name} hasMore`).toBe(true);
        expect(
          typeof first.pagination.nextCursor,
          `${route.name} nextCursor`,
        ).toBe("string");
        expect(Object.keys(first).sort(), `${route.name} envelope`).toEqual([
          "data",
          "pagination",
        ]);
        expect(
          Object.keys(first.pagination).sort(),
          `${route.name} pagination`,
        ).toEqual(["hasMore", "nextCursor"]);

        const paged = await drain(base, 1);
        // No duplicate logical pair across the page boundary…
        expect(new Set(paged).size, `${route.name} duplicates`).toBe(
          paged.length,
        );
        // …and the union is exactly the authored rows, no more and no fewer.
        expect([...paged].sort(), `${route.name} union`).toEqual(
          [...route.expected(graph)].sort(),
        );
        // The same rows in the same order when the whole traversal fits one page.
        expect(await drain(base, 50), `${route.name} single page`).toEqual(
          paged,
        );
      }
    });

    it("012 EARS-12.1: when a public caller asks any of the eight directions for more than the bounded maximum, the system shall refuse the query rather than serve an unbounded page", async () => {
      const graph = await seedGraph();

      for (const route of ROUTES) {
        const res = await publicGet(`${route.url(graph)}?limit=51`);
        expect(res.statusCode, `${route.name} → ${res.payload}`).toBe(400);
      }
    });

    it("012 EARS-12.1: when an event-ordered direction pages over instants stored with microsecond precision, the cursor shall advance past the row that issued it rather than serve it again", async () => {
      const graph = await seedGraph();

      // The instants under test really do carry sub-millisecond digits — the
      // precision a JavaScript `Date` cannot hold, and therefore the precision a
      // cursor encoded from one silently drops.
      const { rows } = await pool.query<{ micros: string }>(
        `SELECT to_char(starts_at, 'US') AS micros FROM events
          WHERE id = ANY($1::uuid[])`,
        [[graph.e1.id, graph.e2.id]],
      );
      expect(rows.some((row) => !row.micros.endsWith("000"))).toBe(true);

      for (const base of [
        `/v1/public/projects/${graph.p1}/events`,
        `/v1/public/directions/${graph.d1}/events`,
      ]) {
        const first = await readPage(`${base}?limit=1`);
        const second = await readPage(
          `${base}?limit=1&cursor=${encodeURIComponent(
            first.pagination.nextCursor!,
          )}`,
        );
        expect(second.data[0]?.id, base).not.toBe(first.data[0]?.id);
        expect(second.pagination, base).toEqual({
          nextCursor: null,
          hasMore: false,
        });
      }
    });

    // ── 12.2 The exact item DTO, and nothing an admin can see ──────────────

    it("012 EARS-12.2: when a zero-auth caller reads any of the eight directions, each item shall carry exactly its §5.2 key set and no lifecycle, storage, join or version field", async () => {
      const graph = await seedGraph();
      // Fields that exist on the row behind the DTO and must never reach a
      // public body — the disclosure regression this assertion exists for.
      const forbidden = [
        "status",
        "deletedAt",
        "deleted_at",
        "version",
        "legacySpeakerId",
        "logoRef",
        "coverRef",
        "photoRef",
        "firstPublishedAt",
        "relationId",
        "createdAt",
        "updatedAt",
      ];

      for (const route of ROUTES) {
        const body = await readPage(route.url(graph));
        expect(body.data.length, `${route.name} seeded items`).toBe(2);

        for (const item of body.data) {
          expect(Object.keys(item).sort(), `${route.name} item keys`).toEqual(
            route.keys,
          );
          for (const key of forbidden) {
            expect(item, `${route.name} leaked ${key}`).not.toHaveProperty(key);
          }
          // Optional URLs are PRESENT and nullable — a caller never has to
          // distinguish «absent» from «none».
          for (const nullable of ["coverUrl", "photoUrl", "logoUrl"]) {
            if (route.keys.includes(nullable)) {
              expect(item, `${route.name} ${nullable}`).toHaveProperty(nullable);
            }
          }
          // The embedded partner is itself the exact §5.2 summary.
          if (route.keys.includes("primaryPartner")) {
            const embedded = item.primaryPartner as Record<
              string,
              unknown
            > | null;
            if (embedded !== null) {
              expect(
                Object.keys(embedded).sort(),
                `${route.name} primaryPartner keys`,
              ).toEqual(sorted(PARTNER_SUMMARY_KEYS));
            }
          }
        }
      }
    });

    it("012 EARS-12.2: when a relationship carries its own attribute, the item shall report the authored role or primary flag rather than a default", async () => {
      const graph = await seedGraph();

      const experts = await readPage(`/v1/public/projects/${graph.p1}/experts`);
      expect(
        Object.fromEntries(
          experts.data.map((item) => [String(item.id), item.role]),
        ),
      ).toEqual({ [graph.x1]: "curator", [graph.x2]: "member" });

      const partners = await readPage(
        `/v1/public/projects/${graph.p1}/partners`,
      );
      expect(
        Object.fromEntries(
          partners.data.map((item) => [String(item.id), item.isPrimary]),
        ),
      ).toEqual({ [graph.t1]: true, [graph.t2]: false });

      const projects = await readPage(
        `/v1/public/experts/${graph.x1}/projects`,
      );
      expect(
        Object.fromEntries(
          projects.data.map((item) => [String(item.id), item.role]),
        ),
      ).toEqual({ [graph.p1]: "curator", [graph.p2]: "member" });
    });

    // ── 12.3 The allow-list applies at EVERY hop ───────────────────────────

    it("012 EARS-12.3: when an endpoint is draft or retired, or the join itself is retired, the relation shall be absent on BOTH directions of every route", async () => {
      const graph = await seedGraph();

      for (const route of ROUTES) {
        const ids = await drain(route.url(graph), 50);
        for (const hidden of route.hidden(graph)) {
          expect(ids, `${route.name} leaked ${hidden}`).not.toContain(hidden);
        }
      }
    });

    it("012 EARS-12.3: when a project's primary partner is not itself publicly eligible, the embedded primaryPartner shall be null rather than a draft organization", async () => {
      const graph = await seedGraph();

      // Reached through the OTHER partner of the same project, so the read is an
      // ordinary traversal rather than a special case.
      const body = await readPage(`/v1/public/partners/${graph.t2}/projects`);
      const item = body.data.find((row) => row.id === graph.pNoPrimary);
      expect(item, "pNoPrimary reachable").toBeDefined();
      expect(item!.primaryPartner).toBeNull();

      // …while an eligible primary IS embedded, on the same read.
      const withPrimary = body.data.find((row) => row.id === graph.p1);
      expect(withPrimary!.primaryPartner).toMatchObject({
        id: graph.t1,
        title: "Альфа-Фарм 1294",
        logoUrl: null,
        websiteUrl: "https://partner.example",
      });
    });

    // ── 12.4 One 404 body, and an empty page that is not a 404 ─────────────

    it("012 EARS-12.4: when the source is unknown, draft or retired, every one of the eight directions shall answer the identical 404 RESOURCE_NOT_FOUND Problem Details", async () => {
      const graph = await seedGraph();
      const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];

      for (const route of ROUTES) {
        for (const url of route.ineligible(graph)) {
          const res = await publicGet(url);
          expect(res.statusCode, `${url} → ${res.payload}`).toBe(404);
          expect(res.headers["content-type"]).toContain("application/problem");
          const body = JSON.parse(res.payload) as Record<string, unknown>;
          expect(body.errorCode, url).toBe("RESOURCE_NOT_FOUND");
          expect(body.traceId, url).toBeTruthy();
          bodies.push({ url, body });
        }
      }
      expect(bodies).toHaveLength(ROUTES.length * 4);

      // A draft, a retired and an unknown source are INDISTINGUISHABLE: the
      // bodies differ only in the per-request trace and the request path.
      const normalize = (body: Record<string, unknown>) => {
        const { traceId: _traceId, instance: _instance, ...rest } = body;
        return rest;
      };
      const [reference, ...others] = bodies;
      for (const other of others) {
        expect(Object.keys(other.body).sort(), other.url).toEqual(
          Object.keys(reference!.body).sort(),
        );
        expect(normalize(other.body), other.url).toEqual(
          normalize(reference!.body),
        );
      }
    });

    it("012 EARS-12.4: when an eligible source has no eligible relations, every one of the eight directions shall answer 200 with an empty, terminal page instead of a 404", async () => {
      const graph = await seedGraph();

      for (const route of ROUTES) {
        const res = await publicGet(route.empty(graph));
        expect(res.statusCode, `${route.name} → ${res.payload}`).toBe(200);
        expect(JSON.parse(res.payload), route.name).toEqual({
          data: [],
          pagination: { nextCursor: null, hasMore: false },
        });
      }
    });

    // ── 12.5 One resolver behind three speaker surfaces ────────────────────

    it("012 EARS-12.5: when an event's speakers are read through the endpoint, the public event page and the upcoming card, all three shall report the same ordered experts and the card exactly name-only items", async () => {
      const graph = await seedGraph();
      await linkEventExpert(graph.e1.id, graph.x1, 0);
      await linkEventExpert(graph.e1.id, graph.x2, 1);

      const endpointRes = await publicGet(
        `/v1/public/events/${graph.e1.slug}/speakers`,
      );
      expect(endpointRes.statusCode, endpointRes.payload).toBe(200);
      const endpoint = JSON.parse(endpointRes.payload) as Array<
        Record<string, unknown>
      >;
      expect(endpoint.map((s) => s.expertId)).toEqual([graph.x1, graph.x2]);

      const pageRes = await publicGet(`/v1/public/events/${graph.e1.slug}`);
      expect(pageRes.statusCode, pageRes.payload).toBe(200);
      const pageSpeakers = (
        JSON.parse(pageRes.payload) as {
          speakers: Array<Record<string, unknown>>;
        }
      ).speakers;
      expect(pageSpeakers).toEqual(endpoint);

      const listRes = await publicGet(`/v1/public/events`);
      expect(listRes.statusCode, listRes.payload).toBe(200);
      const card = (
        JSON.parse(listRes.payload) as Array<{
          id: string;
          speakers: Array<Record<string, unknown>>;
        }>
      ).find((c) => c.id === graph.e1.id);
      expect(card, "upcoming card for the seeded event").toBeDefined();
      // The card is the SAME ordered projection, mapped to its thinner shape.
      expect(card!.speakers).toEqual(endpoint.map((s) => ({ name: s.name })));
      for (const speaker of card!.speakers) {
        expect(Object.keys(speaker)).toEqual(["name"]);
      }
    });

    // ── 12.6 A cursor belongs to the route that issued it ──────────────────

    it("012 EARS-12.6: when a cursor issued by one direction is replayed on a differently-ordered direction, the system shall refuse it with 400 CURSOR_INVALID rather than use it as a query operand", async () => {
      const graph = await seedGraph();

      // The three order tuples in play: events order on `{ startsAt, id }`,
      // projects/partners/directions on `{ title, id }`, experts on
      // `{ name, id }`. A cursor is opaque BY CONTRACT — carrying one across
      // tuples must be refused, not silently coerced into a `WHERE` operand.
      const donors: Array<{ from: string; to: string }> = [
        {
          from: `/v1/public/projects/${graph.p1}/events`,
          to: `/v1/public/events/${graph.e1.id}/projects`,
        },
        {
          from: `/v1/public/events/${graph.e1.id}/projects`,
          to: `/v1/public/directions/${graph.d1}/events`,
        },
        {
          from: `/v1/public/projects/${graph.p1}/experts`,
          to: `/v1/public/projects/${graph.p1}/partners`,
        },
        {
          from: `/v1/public/projects/${graph.p1}/partners`,
          to: `/v1/public/projects/${graph.p1}/experts`,
        },
      ];

      for (const { from, to } of donors) {
        const issued = (await readPage(`${from}?limit=1`)).pagination.nextCursor;
        expect(issued, `${from} issued a cursor`).toBeTruthy();

        const res = await publicGet(
          `${to}?limit=1&cursor=${encodeURIComponent(issued!)}`,
        );
        expect(res.statusCode, `${from} → ${to}: ${res.payload}`).toBe(400);
        expect(
          (JSON.parse(res.payload) as { errorCode: string }).errorCode,
          `${from} → ${to}`,
        ).toBe("CURSOR_INVALID");
      }
    });
  },
);

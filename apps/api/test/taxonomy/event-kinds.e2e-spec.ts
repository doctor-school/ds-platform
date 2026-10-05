import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { StatisticsRepository } from "../../src/storefront/statistics.repository.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import {
  SEED_EVENT_KINDS,
  TEST_EVENT_KIND_ID,
  type TestEventAudience,
} from "../setup/event-classification.js";

// 012 EARS-25…30 (#2509) — the event-kind dictionary, the event's required kind
// + audience, and the per-storefront selection rule, over the REAL stack:
// Fastify + the 011 admin session + Postgres. The forward migration's mapping,
// abort and deletions are proven by `test/db/event-kinds-migration.e2e-spec.ts`;
// this suite owns the runtime contract.
//
// Skips when the stand is absent, exactly as the other taxonomy suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-25…30 event kinds and audience (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdKindIds: string[] = [];
    const createdEventIds: string[] = [];
    const createdProjectIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    function marker(): string {
      return Math.random().toString(36).slice(2, 8);
    }

    function jsonHeaders(extra: Record<string, string> = {}) {
      return {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        "idempotency-key": key(),
        ...extra,
      };
    }

    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds2509${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    interface KindBody {
      id: string;
      slug: string;
      title: string;
      allowedFormats: string[];
      status: string;
      version: number;
    }

    interface Problem {
      issues?: { path: (string | number)[] }[];
    }

    // ── kind helpers ─────────────────────────────────────────────────────

    async function createKind(payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/event-kinds",
        headers: jsonHeaders(),
        payload,
      });
    }

    async function newKind(
      allowedFormats: string[],
      title = `Формат ${marker()}`,
    ): Promise<KindBody> {
      const res = await createKind({ title, allowedFormats });
      expect(res.statusCode).toBe(201);
      const body = res.json() as KindBody;
      createdKindIds.push(body.id);
      return body;
    }

    async function publishKind(kind: KindBody): Promise<KindBody> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/event-kinds/${kind.id}/publish`,
        headers: jsonHeaders({ "if-match": `W/"${kind.version}"` }),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      return res.json() as KindBody;
    }

    async function patchKind(kind: KindBody, payload: Record<string, unknown>) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/event-kinds/${kind.id}`,
        headers: jsonHeaders({ "if-match": `W/"${kind.version}"` }),
        payload,
      });
    }

    async function retireKind(kind: KindBody) {
      const preview = await app.inject({
        method: "GET",
        url: `/v1/admin/event-kinds/${kind.id}/lifecycle-impact?transition=retire`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(preview.statusCode).toBe(200);
      const p = preview.json() as {
        version: number;
        impactToken: string;
        affected: { kind: string; id: string }[];
      };
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/event-kinds/${kind.id}/retire`,
        headers: jsonHeaders({
          "if-match": `W/"${p.version}"`,
          "lifecycle-impact-token": p.impactToken,
        }),
        payload: {},
      });
      return { preview: p, res };
    }

    async function publicKinds(): Promise<Record<string, unknown>[]> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/event-kinds",
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: Record<string, unknown>[] }).data;
    }

    // ── event helpers ────────────────────────────────────────────────────

    function eventPayload(overrides: Record<string, unknown> = {}) {
      return {
        title: `Событие 2509 ${marker()}`,
        school: "Кардиология",
        startsAtMsk: "2031-03-17T19:00",
        durationMin: 90,
        specialties: ["cardiology"],
        kindId: TEST_EVENT_KIND_ID,
        audience: "experts",
        ...overrides,
      };
    }

    async function createEvent(payload: Record<string, unknown>) {
      const mp = multipartBody({ payload: JSON.stringify(payload) });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      if (res.statusCode === 201) {
        createdEventIds.push((res.json() as { id: string }).id);
      }
      return res;
    }

    async function patchEvent(id: string, payload: Record<string, unknown>) {
      const mp = multipartBody({ payload: JSON.stringify(payload) });
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
    }

    async function adminEvent(id: string) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as {
        kind: { id: string; slug: string; title: string };
        participationFormat: string;
        audience: string;
        title: string;
      };
    }

    /** A published event seeded directly — the read-side fixture. */
    async function seedEvent(opts: {
      audience: TestEventAudience;
      kindId?: string;
      format?: "online" | "offline" | "hybrid";
      startsAt?: string;
      state?: "published" | "ended";
    }): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `kinds-2509-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, state,
            participation_format, kind_id, audience)
         VALUES ($1, $2, $3, 'Школа 2509', $4, 60, $5, $6, $7, $8)`,
        [
          id,
          slug,
          `Событие ${slug}`,
          opts.startsAt ?? new Date(Date.now() + 2 * 86_400_000).toISOString(),
          opts.state ?? "published",
          opts.format ?? "online",
          opts.kindId ?? TEST_EVENT_KIND_ID,
          opts.audience,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    function fieldOf(res: { json: () => unknown }): (string | number)[][] {
      return ((res.json() as Problem).issues ?? []).map((i) => i.path);
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
      await app.register(multipart, {
        limits: { fileSize: 25 * 1024 * 1024 },
      });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("kinds-admin"),
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      adminSid = (
        await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        })
      ).sid;
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await deleteEventFixture(pool, id);
      }
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM event_projects WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const id of createdKindIds.splice(0)) {
        await pool.query("DELETE FROM event_kinds WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    // ── EARS-25 / EARS-27: the dictionary ────────────────────────────────

    it("012 EARS-25: when a platform_admin creates and edits an event kind, the system shall persist one retained draft row with a system slug, version and a non-empty allowed-format set, rendered the same on list and detail", async () => {
      const title = `Круглый стол ${marker()}`;
      const kind = await newKind(["online", "hybrid"], title);
      expect(kind).toMatchObject({
        title,
        allowedFormats: ["online", "hybrid"],
        status: "draft",
        version: 1,
      });
      expect(kind.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

      const edited = await patchKind(kind, { title: `${title} — 2` });
      expect(edited.statusCode).toBe(200);
      const body = edited.json() as KindBody;
      expect(body).toMatchObject({ id: kind.id, version: 2 });

      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/event-kinds/${kind.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        id: kind.id,
        title: `${title} — 2`,
        allowedFormats: ["online", "hybrid"],
      });
      const list = await app.inject({
        method: "GET",
        url: "/v1/admin/event-kinds?pageSize=100",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(list.statusCode).toBe(200);
      const row = (list.json() as { data: KindBody[] }).data.find(
        (k) => k.id === kind.id,
      );
      expect(row).toMatchObject({
        title: `${title} — 2`,
        allowedFormats: ["online", "hybrid"],
        status: "draft",
      });
    });

    it("012 EARS-25: an empty or unknown allowed-format set, an authored slug or a storefront attribute is refused at the boundary and nothing is written", async () => {
      const before = await pool.query<{ count: string }>(
        "SELECT count(*) FROM event_kinds",
      );
      for (const payload of [
        { title: `Пусто ${marker()}`, allowedFormats: [] },
        { title: `Чужой ${marker()}`, allowedFormats: ["webinar"] },
        { title: `Слаг ${marker()}`, allowedFormats: ["online"], slug: "x" },
        {
          title: `Витрина ${marker()}`,
          allowedFormats: ["online"],
          audience: "doctors",
        },
      ]) {
        const res = await createKind(payload);
        expect(res.statusCode).toBe(400);
      }
      const after = await pool.query<{ count: string }>(
        "SELECT count(*) FROM event_kinds",
      );
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    });

    it("012 EARS-27: the dictionary carries the five seeded kinds as ordinary published rows with their allowed formats", async () => {
      const { rows } = await pool.query<{
        id: string;
        slug: string;
        title: string;
        status: string;
        allowed_formats: string[];
      }>(
        "SELECT id, slug, title, status, allowed_formats::text[] AS allowed_formats FROM event_kinds WHERE id = ANY($1::uuid[])",
        [Object.values(SEED_EVENT_KINDS).map((k) => k.id)],
      );
      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      expect(bySlug.size).toBe(5);
      const expected: Record<string, [string, string[]]> = {
        vebinar: ["Вебинар", ["online"]],
        efir: ["Эфир", ["online"]],
        kongress: ["Конгресс", ["offline", "hybrid"]],
        "vstrecha-kluba": ["Встреча клуба", ["online", "offline", "hybrid"]],
        "master-klass": ["Мастер-класс", ["offline", "hybrid"]],
      };
      for (const [slug, [title, formats]] of Object.entries(expected)) {
        const row = bySlug.get(slug);
        expect(row?.title).toBe(title);
        expect(row?.status).toBe("published");
        expect([...row!.allowed_formats].sort()).toEqual([...formats].sort());
      }
    });

    // ── EARS-28: public list, summaries, retire ──────────────────────────

    it("012 EARS-28: a kind the editor publishes reaches the public kind list as { id, slug, title } and the event summaries with no code change; a draft kind does not", async () => {
      const draft = await newKind(["online"]);
      expect((await publicKinds()).map((k) => k.id)).not.toContain(draft.id);

      const published = await publishKind(draft);
      const listed = (await publicKinds()).find((k) => k.id === draft.id);
      expect(listed).toEqual({
        id: draft.id,
        slug: published.slug,
        title: published.title,
      });

      // The event summary of a public traversal carries the stored kind.
      const projectId = randomUUID();
      await pool.query(
        `INSERT INTO projects (id, slug, kind, title, default_audience, status, first_published_at)
         VALUES ($1, $2, 'school', 'Проект 2509', 'experts', 'published', now())`,
        [projectId, `p-2509-${projectId.slice(0, 8)}`],
      );
      createdProjectIds.push(projectId);
      const event = await seedEvent({ audience: "experts", kindId: draft.id });
      await pool.query(
        "INSERT INTO event_projects (event_id, project_id) VALUES ($1, $2)",
        [event.id, projectId],
      );
      const summaries = await app.inject({
        method: "GET",
        url: `/v1/public/projects/${projectId}/events`,
      });
      expect(summaries.statusCode).toBe(200);
      const summary = (
        summaries.json() as {
          data: { id: string; kind: Record<string, unknown> }[];
        }
      ).data.find((s) => s.id === event.id);
      expect(summary?.kind).toEqual({
        id: draft.id,
        slug: published.slug,
        title: published.title,
      });
    });

    it("012 EARS-28: retiring a kind goes through the signed lifecycle-impact preview, keeps the events' retained reference and drops the kind from the public list", async () => {
      const kind = await publishKind(await newKind(["online"]));
      const event = await seedEvent({ audience: "doctors", kindId: kind.id });

      const { preview, res } = await retireKind(kind);
      expect(preview.affected.map((a) => a.id)).toContain(event.id);
      expect(res.statusCode).toBe(200);
      expect((res.json() as KindBody).status).toBe("retired");

      const { rows } = await pool.query<{ kind_id: string }>(
        "SELECT kind_id FROM events WHERE id = $1",
        [event.id],
      );
      expect(rows[0]!.kind_id).toBe(kind.id);
      expect((await publicKinds()).map((k) => k.id)).not.toContain(kind.id);

      // A retired kind is no longer selectable for a new event.
      const refused = await createEvent(eventPayload({ kindId: kind.id }));
      expect(refused.statusCode).toBe(400);
      expect(fieldOf(refused)).toContainEqual(["kindId"]);
    });

    // ── EARS-26: the event's kind ────────────────────────────────────────

    it("012 EARS-26: an event write refuses a missing, unknown or draft kind with a field error and writes nothing", async () => {
      const draft = await newKind(["online"]);
      const { kindId: _omit, ...withoutKind } = eventPayload();
      const missing = await createEvent(withoutKind);
      expect(missing.statusCode).toBe(400);
      expect(fieldOf(missing)).toContainEqual(["kindId"]);

      for (const kindId of [randomUUID(), draft.id]) {
        const title = `Отказ ${marker()}`;
        const res = await createEvent(eventPayload({ kindId, title }));
        expect(res.statusCode).toBe(400);
        expect(fieldOf(res)).toContainEqual(["kindId"]);
        const { rows } = await pool.query(
          "SELECT 1 FROM events WHERE title = $1",
          [title],
        );
        expect(rows).toHaveLength(0);
      }
    });

    it("012 EARS-26: an event create or update naming a retired kind is refused with a field error, and nothing is written", async () => {
      const retired = await publishKind(
        await newKind(["online", "offline", "hybrid"]),
      );
      await retireKind(retired);

      const title = `Отказ ${marker()}`;
      const created = await createEvent(
        eventPayload({ kindId: retired.id, title }),
      );
      expect(created.statusCode).toBe(400);
      expect(fieldOf(created)).toContainEqual(["kindId"]);
      const { rows } = await pool.query(
        "SELECT 1 FROM events WHERE title = $1",
        [title],
      );
      expect(rows).toHaveLength(0);

      const ok = await createEvent(
        eventPayload({
          kindId: SEED_EVENT_KINDS.kongress.id,
          participationFormat: "offline",
        }),
      );
      expect(ok.statusCode).toBe(201);
      const id = (ok.json() as { id: string }).id;
      const save = await patchEvent(id, { kindId: retired.id });
      expect(save.statusCode).toBe(400);
      expect(fieldOf(save)).toContainEqual(["kindId"]);
      expect((await adminEvent(id)).kind.id).toBe(SEED_EVENT_KINDS.kongress.id);
    });

    it("012 EARS-26: a participation format the kind does not allow is refused with a field error on create and on save", async () => {
      const refused = await createEvent(
        eventPayload({
          kindId: SEED_EVENT_KINDS.vebinar.id,
          participationFormat: "offline",
        }),
      );
      expect(refused.statusCode).toBe(400);
      expect(fieldOf(refused)).toContainEqual(["participationFormat"]);

      const ok = await createEvent(
        eventPayload({
          kindId: SEED_EVENT_KINDS.kongress.id,
          participationFormat: "offline",
        }),
      );
      expect(ok.statusCode).toBe(201);
      const id = (ok.json() as { id: string }).id;
      const save = await patchEvent(id, {
        kindId: SEED_EVENT_KINDS.vebinar.id,
      });
      expect(save.statusCode).toBe(400);
      expect(fieldOf(save)).toContainEqual(["participationFormat"]);
      expect((await adminEvent(id)).kind.id).toBe(SEED_EVENT_KINDS.kongress.id);
    });

    it("012 EARS-25: narrowing a kind's allowed formats is refused, naming the events, while a retained event of that kind carries a removed format, and accepted once none does", async () => {
      const kind = await publishKind(await newKind(["online", "offline"]));
      const event = await seedEvent({
        audience: "experts",
        kindId: kind.id,
        format: "offline",
      });
      const { title } = await adminEvent(event.id);

      const refused = await patchKind(kind, { allowedFormats: ["online"] });
      expect(refused.statusCode).toBe(409);
      const problem = refused.json() as {
        errorCode: string;
        errors?: { path: string; message: string }[];
      };
      expect(problem.errorCode).toBe("RELATIONSHIP_CONFLICT");
      const field = problem.errors?.find((e) => e.path === "allowedFormats");
      expect(field?.message).toContain(event.id);
      expect(field?.message).toContain(title);
      // One addressed entry per conflicting event, so the admin kind form can
      // name (and link) each event without parsing the summary sentence.
      expect(problem.errors).toContainEqual({
        path: `allowedFormats.events.${event.id}`,
        message: title,
      });

      const unchanged = await app.inject({
        method: "GET",
        url: `/v1/admin/event-kinds/${kind.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(unchanged.json()).toMatchObject({
        allowedFormats: ["online", "offline"],
        version: kind.version,
      });
      expect((await adminEvent(event.id)).participationFormat).toBe("offline");

      const moved = await patchEvent(event.id, {
        participationFormat: "online",
      });
      expect(moved.statusCode).toBe(200);

      const accepted = await patchKind(kind, { allowedFormats: ["online"] });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ allowedFormats: ["online"] });
    });

    // ── EARS-29: the event's audience ────────────────────────────────────

    it("012 EARS-29: an event write requires one audience doctors | experts and refuses a missing or unknown one", async () => {
      const { audience: _omit, ...withoutAudience } = eventPayload();
      const missing = await createEvent(withoutAudience);
      expect(missing.statusCode).toBe(400);
      expect(fieldOf(missing)).toContainEqual(["audience"]);
      const unknown = await createEvent(eventPayload({ audience: "pharma" }));
      expect(unknown.statusCode).toBe(400);

      const ok = await createEvent(eventPayload({ audience: "doctors" }));
      expect(ok.statusCode).toBe(201);
      const id = (ok.json() as { id: string }).id;
      expect((await adminEvent(id)).audience).toBe("doctors");
    });

    it("012 EARS-29: every public listing read selects by audience — a doctors event shows only on the doctor storefront and an experts event only on the Academy", async () => {
      const doctors = await seedEvent({ audience: "doctors" });
      const experts = await seedEvent({ audience: "experts" });

      const academy = await app.inject({
        method: "GET",
        url: "/v1/public/events?upcoming",
      });
      expect(academy.statusCode).toBe(200);
      const academyIds = (academy.json() as { id: string }[]).map((e) => e.id);
      expect(academyIds).toContain(experts.id);
      expect(academyIds).not.toContain(doctors.id);

      const feed = await app.inject({
        method: "GET",
        url: "/v1/storefront/doctor/events?specialty=all",
      });
      expect(feed.statusCode).toBe(200);
      const feedIds = (
        feed.json() as { days: { items: { id: string }[] }[] }
      ).days.flatMap((d) => d.items.map((i) => i.id));
      expect(feedIds).toContain(doctors.id);
      expect(feedIds).not.toContain(experts.id);
    });

    it("012 EARS-29: the doctor storefront's events-per-year figure counts only events whose audience is doctors", async () => {
      const stats = app.get(StatisticsRepository);
      const before = await stats.countEventsPerYear();
      const past = new Date(Date.now() - 30 * 86_400_000).toISOString();
      await seedEvent({ audience: "experts", startsAt: past, state: "ended" });
      expect(await stats.countEventsPerYear()).toBe(before);
      await seedEvent({ audience: "doctors", startsAt: past, state: "ended" });
      expect(await stats.countEventsPerYear()).toBe(before + 1);
    });

    // ── EARS-30: the project's default audience ──────────────────────────

    it("012 EARS-30: a project write requires a default audience, and a later change of it changes no existing event's audience", async () => {
      const base = { kind: "school", title: `Школа 2509 ${marker()}` };
      const missing = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: jsonHeaders(),
        payload: base,
      });
      expect(missing.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: jsonHeaders(),
        payload: { ...base, defaultAudience: "doctors" },
      });
      expect(created.statusCode).toBe(201);
      const project = created.json() as {
        id: string;
        version: number;
        defaultAudience: string;
      };
      createdProjectIds.push(project.id);
      expect(project.defaultAudience).toBe("doctors");

      const event = await seedEvent({ audience: "doctors" });
      await pool.query(
        "INSERT INTO event_projects (event_id, project_id) VALUES ($1, $2)",
        [event.id, project.id],
      );

      const changed = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${project.id}`,
        headers: jsonHeaders({ "if-match": `W/"${project.version}"` }),
        payload: { defaultAudience: "experts" },
      });
      expect(changed.statusCode).toBe(200);
      expect(
        (changed.json() as { defaultAudience: string }).defaultAudience,
      ).toBe("experts");
      const { rows } = await pool.query<{ audience: string }>(
        "SELECT audience FROM events WHERE id = $1",
        [event.id],
      );
      expect(rows[0]!.audience).toBe("doctors");
    });
  },
);

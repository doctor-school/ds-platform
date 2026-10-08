import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import {
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
  CongressSubmissionCardSchema,
  CongressSubmissionRegistrySchema,
  CongressSubmissionSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  congressSubmissionDecisionMessage,
  formatRevisionLastDay,
} from "../../src/mailer/notice-emails.js";
import { CONGRESS_SIGN_UP_CLOCK } from "../../src/congress/congress-signup.tokens.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";
import type { MatrixRow } from "../../src/authz/authz.matrix.js";
import { ADMIN_DEVICE, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * 046 EARS-26…EARS-31, EARS-34, EARS-35 (#2437) — the programme committee over
 * the REAL routes of the REAL module: verification rows V-10 (the committee
 * part), V-11 and V-12.
 *
 * The committee member holds ONLY `congress-program-committee` (the
 * registration cascade's `doctor_guest` is revoked), so every refusal is the
 * boundary's and not a side effect of a second role. The author drives the
 * cabinet routes with a real doctor session; the clock the congress services
 * read is overridable so V-12's dated cases run on their own calendar.
 */

const COMMITTEE = "congress-program-committee";
const BASE = "/v1/me/congress-submissions";
const DAY = 24 * 60 * 60 * 1000;
const msk = (local: string) => new Date(`${local}+03:00`);

/** EARS-26 — every route the committee role may carry: its reach + the session. */
const COMMITTEE_ALLOW_SET: ReadonlySet<string> = new Set([
  "GET /v1/admin/events/:idOrSlug/congress-submissions",
  "GET /v1/admin/events/:idOrSlug/congress-submissions/:submissionId",
  "POST /v1/admin/events/:idOrSlug/congress-submissions/:submissionId/status",
  "POST /v1/admin/auth/login",
  "GET /v1/admin/auth/state",
  "POST /v1/admin/auth/mfa/enroll/start",
  "POST /v1/admin/auth/mfa/enroll/verify",
  "POST /v1/admin/auth/mfa/verify",
  "GET /v1/admin/auth/session",
  "POST /v1/admin/auth/logout",
]);
const SESSION_HOLD = new Set(
  [...COMMITTEE_ALLOW_SET].filter((e) => e.includes("/auth/")),
);

describe("046 EARS-26 — the committee denial set (route classification)", () => {
  let rows: MatrixRow[];

  beforeAll(async () => {
    const scan = await scanRealRouteSet();
    rows = scan.rows;
    expect(scan.violations).toEqual([]);
  }, 60_000);

  const rolesOf = (row: MatrixRow) => (row.meta.roles ?? []) as string[];

  it("046 EARS-26: every real route outside the committee allow-set omits congress-program-committee", () => {
    const outside = rows.filter((r) => !COMMITTEE_ALLOW_SET.has(r.endpoint));
    expect(outside.length).toBeGreaterThan(50);
    for (const row of outside) {
      expect(rolesOf(row), row.endpoint).not.toContain(COMMITTEE);
    }
  });

  it("046 EARS-26: every committee route is real and a resource-scoped policy row — the role alone never admits an event", () => {
    const discovered = new Set(rows.map((r) => r.endpoint));
    expect([...COMMITTEE_ALLOW_SET].filter((e) => !discovered.has(e))).toEqual(
      [],
    );
    const reach = rows.filter(
      (r) => rolesOf(r).includes(COMMITTEE) && !SESSION_HOLD.has(r.endpoint),
    );
    expect(reach).toHaveLength(3);
    for (const row of reach) {
      expect(row.meta.check, row.endpoint).toBe("policy");
      expect(row.meta.objectAttrs ?? [], row.endpoint).toEqual([]);
    }
  });

  it("046 EARS-35: the extension route admits the platform administrator only and revalidates live", () => {
    const row = rows.find(
      (r) =>
        r.endpoint ===
        "POST /v1/admin/events/:idOrSlug/congress-submissions/:submissionId/revision-deadline",
    );
    expect(row?.meta.roles).toEqual(["platform_admin"]);
    expect(row?.meta.revalidate).toBe("live");
  });
});

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "046 programme committee — registry, card, status change, deadline (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    /** `null` = the real clock; set for the V-12 calendar cases. */
    const clock: { at: Date | null } = { at: null };
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(CONGRESS_SIGN_UP_CLOCK)
        .useValue(() => clock.at ?? new Date())
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    }, 60_000);

    beforeEach(() => {
      clock.at = null;
    });

    afterAll(async () => {
      if (pool) {
        for (const id of createdEventIds) await deleteEventFixture(pool, id);
        for (const email of createdEmails)
          await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    // ------------------------------------------------------------ fixtures

    const uniqueEmail = (prefix: string) => {
      const email = `ears2437-${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    };

    async function account(prefix: string) {
      const email = uniqueEmail(prefix);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      const { rows } = await pool.query<{ id: string; zitadel_sub: string }>(
        "SELECT id, zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      return { email, userId: rows[0]!.id, sub: rows[0]!.zitadel_sub };
    }

    /** A committee-only principal with an admin session, bound to `events`. */
    async function committee(prefix: string, ...eventIds: string[]) {
      const a = await account(prefix);
      await fake.revokeProjectRole(a.sub, "doctor_guest");
      await fake.grantProjectRole(a.sub, COMMITTEE);
      expect(fake.grantedRoles(a.sub)).toEqual([COMMITTEE]);
      for (const eventId of eventIds) {
        // The grant as the tech lead inserts it until #2378.
        await pool.query(
          `INSERT INTO event_role_grants (user_id, role, event_id)
           VALUES ($1, $2, $3)`,
          [a.userId, COMMITTEE, eventId],
        );
      }
      const session = await establishAdminSession(app, {
        identifier: a.email,
        password,
        device: ADMIN_DEVICE,
      });
      return { ...a, headers: session.headers };
    }

    async function platformAdmin(prefix: string) {
      const a = await account(prefix);
      await fake.grantProjectRole(a.sub, "platform_admin");
      const session = await establishAdminSession(app, {
        identifier: a.email,
        password,
        device: ADMIN_DEVICE,
      });
      return { ...a, headers: session.headers };
    }

    async function author(prefix: string) {
      const a = await account(prefix);
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: a.email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      return {
        ...a,
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie!.value}`,
        },
      };
    }
    type Author = Awaited<ReturnType<typeof author>>;

    /** A congress event with an oral window (and a poster one) and its settings. */
    async function congress(
      window: { opensAt: Date; closesAt: Date; submitLimit?: number | null },
      startsAt = "2027-04-23T09:00:00.000Z",
    ) {
      const id = randomUUID();
      const slug = `congress-pc-${id.slice(0, 8)}`;
      createdEventIds.push(id);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,'Конгресс','Конгресс',$3,480,'Ежегодный конгресс.',
                 ARRAY['cardiology'],'sponsor:congress',NULL,'published',
                 'offline', ${eventClassificationSql()})`,
        [id, slug, startsAt],
      );
      await pool.query(
        `INSERT INTO congress_submission_settings (event_id, registration_url)
         VALUES ($1, 'https://orthobio.ru/registration')`,
        [id],
      );
      for (const kind of ["oral", "poster"]) {
        await pool.query(
          `INSERT INTO congress_submission_kind_settings
             (event_id, kind, opens_at, closes_at, submit_limit)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            kind,
            window.opensAt,
            window.closesAt,
            window.submitLimit ?? null,
          ],
        );
      }
      return { id, slug };
    }

    const openNow = () => ({
      opensAt: new Date(Date.now() - DAY),
      closesAt: new Date(Date.now() + 30 * DAY),
    });

    async function register(a: Author, eventId: string, answers?: object) {
      await pool.query(
        `INSERT INTO registrations (user_id, event_id, answers) VALUES ($1, $2, $3)`,
        [a.userId, eventId, answers ?? null],
      );
    }

    const ORAL = {
      title: "Эндопротезирование коленного сустава",
      authors: [
        {
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          workplace: "ГКБ №1",
          presenting: true,
        },
      ],
      body: { goal: "Разобрать показания.", summary: "Краткое содержание." },
    };

    async function draft(a: Author, eventId: string, title = ORAL.title) {
      const created = await app.inject({
        method: "POST",
        url: BASE,
        headers: a.headers,
        payload: { eventId, kind: "oral" },
      });
      expect(created.statusCode, created.payload).toBe(201);
      const id = CongressSubmissionSchema.parse(created.json()).id;
      const saved = await app.inject({
        method: "PATCH",
        url: `${BASE}/${id}`,
        headers: a.headers,
        payload: { ...ORAL, title },
      });
      expect(saved.statusCode, saved.payload).toBe(200);
      return id;
    }

    const send = (a: Author, id: string) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/send`,
        headers: a.headers,
        payload: {
          acceptedConsents: [CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
        },
      });

    async function submitted(a: Author, eventId: string, title?: string) {
      const id = await draft(a, eventId, title);
      const res = await send(a, id);
      expect(res.statusCode, res.payload).toBe(200);
      return id;
    }

    const admin = (headers: Record<string, string>) => ({
      get: (url: string) => app.inject({ method: "GET", url, headers }),
      post: (url: string, payload: unknown) =>
        app.inject({ method: "POST", url, headers, payload }),
    });

    const registryUrl = (event: string, query = "") =>
      `/v1/admin/events/${event}/congress-submissions${query}`;
    const cardUrl = (event: string, id: string) =>
      `/v1/admin/events/${event}/congress-submissions/${id}`;

    async function setStatus(
      headers: Record<string, string>,
      event: string,
      id: string,
      payload: object,
    ) {
      return admin(headers).post(`${cardUrl(event, id)}/status`, payload);
    }

    async function row(id: string) {
      const { rows } = await pool.query<{
        status: string;
        revision_due_at: Date | null;
        committee_comment: string | null;
        last_letter_kind: string | null;
        last_letter_status: string | null;
      }>(
        `SELECT status, revision_due_at, committee_comment, last_letter_kind,
                last_letter_status
           FROM congress_submissions WHERE id = $1`,
        [id],
      );
      return rows[0]!;
    }

    /** Letters go off the response path — poll for the recorded outcome. */
    async function waitForLetter(id: string, kind: string) {
      return vi.waitFor(
        async () => {
          const r = await row(id);
          expect(r.last_letter_kind).toBe(kind);
          expect(r.last_letter_status).not.toBeNull();
          return r;
        },
        { timeout: 5000, interval: 50 },
      );
    }

    const decisionsTo = (email: string) =>
      mailer.congressSubmissionDecisions.filter((l) => l.to === email);

    // ------------------------------------------------- V-10 — the boundary

    it("046 EARS-26: a committee member bound to event A reads A's registry and card, by slug and id", async () => {
      const a = await congress(openNow());
      const doc = await author("v10-author");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v10-bound", a.id);

      for (const key of [a.slug, a.id]) {
        const list = await admin(member.headers).get(registryUrl(key));
        expect(list.statusCode, list.payload).toBe(200);
        const body = CongressSubmissionRegistrySchema.parse(list.json());
        expect(body.event.id).toBe(a.id);
        expect(body.rows.map((r) => r.id)).toEqual([id]);
        const card = await admin(member.headers).get(cardUrl(key, id));
        expect(card.statusCode, card.payload).toBe(200);
        expect(CongressSubmissionCardSchema.parse(card.json()).id).toBe(id);
      }
    }, 60_000);

    it("046 EARS-26: a member bound to A is refused event B, an unknown event, the 044 roster, the events list and the extension", async () => {
      const a = await congress(openNow());
      const b = await congress(openNow());
      const doc = await author("v10-other");
      await register(doc, b.id);
      const idB = await submitted(doc, b.id);
      const member = await committee("v10-other-m", a.id);
      const m = admin(member.headers);

      for (const url of [
        registryUrl(b.slug),
        registryUrl(b.id),
        cardUrl(b.id, idB),
        cardUrl(a.id, idB),
        registryUrl(`no-such-congress-${randomUUID().slice(0, 8)}`),
        `/v1/admin/events/${a.slug}/roster`,
        "/v1/admin/events",
        `/v1/admin/events/${a.id}/congress-intake-settings`,
      ]) {
        const res = await m.get(url);
        // `cardUrl(a.id, idB)` is A's route with B's id — bound, so 404.
        expect(res.statusCode, url).toBe(
          url === cardUrl(a.id, idB) ? 404 : 403,
        );
      }
      const statusB = await setStatus(member.headers, b.id, idB, {
        status: "in_review",
        expectedStatus: "submitted",
      });
      expect([401, 403]).toContain(statusB.statusCode);
      const extend = await m.post(`${cardUrl(b.id, idB)}/revision-deadline`, {
        lastDay: "2099-01-01",
      });
      expect([401, 403]).toContain(extend.statusCode);
    }, 60_000);

    it("046 EARS-26: a member with the role and no binding is refused everywhere but its session", async () => {
      const a = await congress(openNow());
      const member = await committee("v10-unbound");
      expect(
        (await admin(member.headers).get(registryUrl(a.id))).statusCode,
      ).toBe(403);
      const session = await admin(member.headers).get("/v1/admin/auth/session");
      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual({ roles: [COMMITTEE], eventGrants: [] });
    }, 60_000);

    it("046 EARS-26: a member may be bound to more than one event, and the session lists every binding", async () => {
      const a = await congress(openNow());
      const b = await congress(openNow());
      const member = await committee("v10-two", a.id, b.id);
      for (const e of [a, b]) {
        expect(
          (await admin(member.headers).get(registryUrl(e.slug))).statusCode,
        ).toBe(200);
      }
      const session = await admin(member.headers).get("/v1/admin/auth/session");
      const grants = (session.json() as { eventGrants: { eventId: string }[] })
        .eventGrants;
      expect(grants.map((g) => g.eventId).sort()).toEqual([a.id, b.id].sort());
    }, 60_000);

    it("046 EARS-27: drafts are never listed and a draft's card is not found", async () => {
      const a = await congress(openNow());
      const doc = await author("v10-draft");
      await register(doc, a.id);
      const draftId = await draft(doc, a.id);
      const sentId = await submitted(doc, a.id, "Отправленная работа");
      const member = await committee("v10-draft-m", a.id);

      const list = CongressSubmissionRegistrySchema.parse(
        (await admin(member.headers).get(registryUrl(a.id))).json(),
      );
      expect(list.rows.map((r) => r.id)).toEqual([sentId]);
      expect(list.total).toBe(1);
      expect(
        (await admin(member.headers).get(cardUrl(a.id, draftId))).statusCode,
      ).toBe(404);
    }, 60_000);

    it("046 EARS-27: filters by kind, status, send date and submitter compose with the title/author search, sort and page", async () => {
      const a = await congress(openNow());
      const ann = await author("v10-ann");
      const bob = await author("v10-bob");
      await register(ann, a.id, {
        surname: "Арбузова",
        firstName: "Анна",
        patronymic: "Сергеевна",
      });
      await register(bob, a.id);
      const annId = await submitted(ann, a.id, "Артроскопия плеча");
      const bobId = await submitted(bob, a.id, "Биомеханика колена");
      const member = await committee("v10-filter", a.id);
      await setStatus(member.headers, a.id, bobId, {
        status: "in_review",
        expectedStatus: "submitted",
      });
      const list = async (query: string) =>
        CongressSubmissionRegistrySchema.parse(
          (await admin(member.headers).get(registryUrl(a.id, query))).json(),
        );

      expect((await list("?status=in_review")).rows.map((r) => r.id)).toEqual([
        bobId,
      ]);
      expect((await list("?kind=poster")).total).toBe(0);
      expect((await list("?submitter=арбуз")).rows.map((r) => r.id)).toEqual([
        annId,
      ]);
      expect(
        (await list(`?submitter=${bob.email}`)).rows.map((r) => r.id),
      ).toEqual([bobId]);
      expect((await list("?q=биомех")).rows.map((r) => r.id)).toEqual([bobId]);
      // Author names are searched too: both carry «Иванова».
      expect((await list("?q=иванов")).total).toBe(2);
      expect((await list("?q=иванов&status=submitted")).total).toBe(1);
      const today = new Date().toISOString().slice(0, 10);
      expect((await list(`?sentFrom=2000-01-01&sentTo=2000-01-02`)).total).toBe(
        0,
      );
      expect((await list(`?sentFrom=${today}`)).total).toBeGreaterThanOrEqual(
        1,
      );
      const byTitle = await list("?sort=title&order=asc");
      expect(byTitle.rows.map((r) => r.title)).toEqual([
        "Артроскопия плеча",
        "Биомеханика колена",
      ]);
      expect(byTitle.rows.map((r) => r.position)).toEqual([1, 2]);
      const page2 = await list("?sort=title&order=asc&pageSize=1&page=2");
      expect(page2.rows.map((r) => [r.position, r.id])).toEqual([[2, bobId]]);
      expect(page2.total).toBe(2);
      expect(byTitle.rows[0]!.submitter).toEqual({
        fullName: "Арбузова Анна Сергеевна",
        email: ann.email,
      });
      expect(
        (await admin(member.headers).get(registryUrl(a.id, "?status=draft")))
          .statusCode,
      ).toBe(400);
    }, 90_000);

    // ---------------------------------------------- V-11 — status change

    it("046 EARS-28: rejected and needs_revision without a comment are refused and change nothing", async () => {
      const a = await congress(openNow());
      const doc = await author("v11-comment");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v11-comment-m", a.id);
      for (const status of ["rejected", "needs_revision"]) {
        for (const comment of [undefined, "  ", "x".repeat(2001)]) {
          const res = await setStatus(member.headers, a.id, id, {
            status,
            expectedStatus: "submitted",
            ...(comment === undefined ? {} : { comment }),
          });
          expect(res.statusCode, `${status}/${comment?.length}`).toBe(400);
        }
      }
      expect((await row(id)).status).toBe("submitted");
    }, 60_000);

    it("046 EARS-28, EARS-29: allowed transitions pass with their letters; in review sends none; off-machine and stale changes are refused", async () => {
      const a = await congress(openNow());
      const doc = await author("v11-flow");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v11-flow-m", a.id);
      const go = (payload: object) =>
        setStatus(member.headers, a.id, id, payload);

      const toReview = await go({
        status: "in_review",
        expectedStatus: "submitted",
      });
      expect(toReview.statusCode, toReview.payload).toBe(200);
      expect(CongressSubmissionCardSchema.parse(toReview.json()).status).toBe(
        "in_review",
      );
      // A stale view: the member still believes it is `submitted`.
      const stale = await go({
        status: "accepted",
        expectedStatus: "submitted",
      });
      expect(stale.statusCode).toBe(409);

      expect(
        (await go({ status: "accepted", expectedStatus: "in_review" }))
          .statusCode,
      ).toBe(200);
      await waitForLetter(id, "accepted");
      // `accepted → rejected` is not an edge; the correction goes via review.
      expect(
        (
          await go({
            status: "rejected",
            expectedStatus: "accepted",
            comment: "Нет",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (await go({ status: "in_review", expectedStatus: "accepted" }))
          .statusCode,
      ).toBe(200);
      const rejected = await go({
        status: "rejected",
        expectedStatus: "in_review",
        comment: "Тема вне программы",
      });
      expect(rejected.statusCode).toBe(200);
      await waitForLetter(id, "rejected");

      const letters = decisionsTo(doc.email);
      expect(letters.map((l) => l.letter)).toEqual(["accepted", "rejected"]);
      expect(letters[1]).toMatchObject({
        letter: "rejected",
        comment: "Тема вне программы",
        title: ORAL.title,
        kindLabel: "Устный доклад",
      });

      const card = CongressSubmissionCardSchema.parse(
        (await admin(member.headers).get(cardUrl(a.id, id))).json(),
      );
      expect(card.committeeComment).toBe("Тема вне программы");
      expect(card.lastLetter).toMatchObject({
        kind: "rejected",
        status: "sent",
      });
      // The status history from the 010 audit, with who and when.
      expect(card.history.map((h) => h.to)).toEqual([
        "draft",
        "submitted",
        "in_review",
        "accepted",
        "in_review",
        "rejected",
      ]);
      const byCommittee = card.history.slice(2);
      for (const h of byCommittee) {
        expect(h.actor).toBe(member.email);
        expect(h.source).not.toBe("db-direct");
      }
    }, 90_000);

    it("046 EARS-28, EARS-29, EARS-34: needs revision carries the comment and the submission's deadline; then accepted or rejected pass", async () => {
      const a = await congress(openNow());
      const doc = await author("v11-rev");
      await register(doc, a.id);
      const id1 = await submitted(doc, a.id, "Первая");
      const id2 = await submitted(doc, a.id, "Вторая");
      const member = await committee("v11-rev-m", a.id);

      for (const id of [id1, id2]) {
        const res = await setStatus(member.headers, a.id, id, {
          status: "needs_revision",
          expectedStatus: "submitted",
          comment: "Сократите аннотацию",
        });
        expect(res.statusCode, res.payload).toBe(200);
        const card = CongressSubmissionCardSchema.parse(res.json());
        expect(card.revisionDueAt).not.toBeNull();
        await waitForLetter(id, "needs_revision");
      }
      const letter = decisionsTo(doc.email).find(
        (l) => l.letter === "needs_revision",
      );
      expect(letter).toMatchObject({ comment: "Сократите аннотацию" });
      const stored = (await row(id1)).revision_due_at!;
      expect(
        letter!.letter === "needs_revision" &&
          letter!.revisionDueAt.toISOString(),
      ).toBe(stored.toISOString());
      // The rendered letter names the deadline's last day.
      const rendered = congressSubmissionDecisionMessage({
        title: "Первая",
        kindLabel: "Устный доклад",
        letter: "needs_revision",
        comment: "Сократите аннотацию",
        lastDay: formatRevisionLastDay(stored),
      });
      expect(rendered.text).toContain(
        `до ${formatRevisionLastDay(stored)}, 23:59 МСК`,
      );

      expect(
        (
          await setStatus(member.headers, a.id, id1, {
            status: "in_review",
            expectedStatus: "needs_revision",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await setStatus(member.headers, a.id, id1, {
            status: "accepted",
            expectedStatus: "needs_revision",
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await setStatus(member.headers, a.id, id2, {
            status: "rejected",
            expectedStatus: "needs_revision",
            comment: "Не доработано",
          })
        ).statusCode,
      ).toBe(200);
    }, 90_000);

    it("046 EARS-28: any change on a withdrawn submission is refused", async () => {
      const a = await congress(openNow());
      const doc = await author("v11-wd");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v11-wd-m", a.id);
      await setStatus(member.headers, a.id, id, {
        status: "in_review",
        expectedStatus: "submitted",
      });
      const wd = await app.inject({
        method: "POST",
        url: `${BASE}/${id}/withdraw`,
        headers: doc.headers,
        payload: { expectedStatus: "in_review" },
      });
      expect(wd.statusCode, wd.payload).toBe(200);
      for (const status of [
        "in_review",
        "accepted",
        "rejected",
        "needs_revision",
      ]) {
        const res = await setStatus(member.headers, a.id, id, {
          status,
          expectedStatus: "withdrawn",
          comment: "Комментарий",
        });
        expect(res.statusCode, status).toBe(409);
      }
      expect((await row(id)).status).toBe("withdrawn");
    }, 60_000);

    it("046 EARS-28: a committee grant withdrawn at the IdP → 403 from live revalidation, nothing changed", async () => {
      const a = await congress(openNow());
      const doc = await author("v11-revoke");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v11-revoke-m", a.id);
      await fake.revokeProjectRole(member.sub, COMMITTEE);
      const res = await setStatus(member.headers, a.id, id, {
        status: "in_review",
        expectedStatus: "submitted",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        errorCode: "PROGRAM_COMMITTEE_REQUIRED",
      });
      expect((await row(id)).status).toBe("submitted");
    }, 60_000);

    it("046 EARS-28: a poster card shows the submitter's age on the event start, never the birth date; email and phone come from the 044 answers", async () => {
      const a = await congress(openNow(), "2027-04-23T09:00:00.000Z");
      const doc = await author("v11-poster");
      await register(doc, a.id, {
        email: "contact@ds.test",
        contactPhone: "+7 900 111-22-33",
      });
      await pool.query(
        "UPDATE users SET birth_date = '1990-04-23' WHERE id = $1",
        [doc.userId],
      );
      const id = randomUUID();
      await pool.query(
        `INSERT INTO congress_submissions
           (id, event_id, registration_id, user_id, kind, status, title, submitted_at)
         SELECT $1, $2, r.id, $3, 'poster', 'submitted', 'Постер', now()
           FROM registrations r WHERE r.user_id = $3 AND r.event_id = $2`,
        [id, a.id, doc.userId],
      );
      const member = await committee("v11-poster-m", a.id);
      const res = await admin(member.headers).get(cardUrl(a.id, id));
      expect(res.statusCode, res.payload).toBe(200);
      const card = CongressSubmissionCardSchema.parse(res.json());
      expect(card.submitter).toMatchObject({
        email: "contact@ds.test",
        phone: "+7 900 111-22-33",
        ageOnEventStart: 37,
      });
      expect(res.payload).not.toContain("1990-04-23");
    }, 60_000);

    it("046 EARS-26, EARS-28: event A's route never reads or writes event B's submission, and B's route answers alike for a real and an unknown id", async () => {
      const a = await congress(openNow());
      const b = await congress(openNow());
      const doc = await author("sec-cross");
      await register(doc, b.id);
      const idB = await submitted(doc, b.id);
      const member = await committee("sec-cross-m", a.id);

      const write = await setStatus(member.headers, a.id, idB, {
        status: "accepted",
        expectedStatus: "submitted",
      });
      expect(write.statusCode, write.payload).toBe(404);
      expect(write.payload).not.toContain(idB);
      expect((await row(idB)).status).toBe("submitted");

      const real = await admin(member.headers).get(cardUrl(b.id, idB));
      const unknown = await admin(member.headers).get(
        cardUrl(b.id, randomUUID()),
      );
      expect(real.statusCode).toBe(403);
      expect(real.payload).toBe(unknown.payload);
    }, 60_000);

    it("046 EARS-27, EARS-28: the card links no draft or other-event source and names no raw IdP subject in the history", async () => {
      const a = await congress(openNow());
      const b = await congress(openNow());
      const doc = await author("sec-card");
      await register(doc, a.id);
      await register(doc, b.id);
      const draftSource = await draft(doc, a.id, "Черновик-источник");
      const otherSource = await submitted(
        doc,
        b.id,
        "Работа другого конгресса",
      );
      const insertAbstract = async (source: string) => {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO congress_submissions
             (id, event_id, registration_id, user_id, kind, status, title,
              derived_from_id, submitted_at)
           SELECT $1, $2, r.id, $3, 'abstract', 'submitted', 'Тезисы', $4, now()
             FROM registrations r WHERE r.user_id = $3 AND r.event_id = $2`,
          [id, a.id, doc.userId, source],
        );
        return id;
      };
      const fromDraft = await insertAbstract(draftSource);
      const fromOther = await insertAbstract(otherSource);
      const ghostSub = `ghost-${randomUUID()}`;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.actor_sub', $1, true)", [
          ghostSub,
        ]);
        await client.query(
          "UPDATE congress_submissions SET status = 'in_review' WHERE id = $1",
          [fromDraft],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const member = await committee("sec-card-m", a.id);

      for (const [id, leaked] of [
        [fromDraft, "Черновик-источник"],
        [fromOther, "Работа другого конгресса"],
      ] as const) {
        const res = await admin(member.headers).get(cardUrl(a.id, id));
        expect(res.statusCode, res.payload).toBe(200);
        const card = CongressSubmissionCardSchema.parse(res.json());
        expect(card.derivedFrom).toBeNull();
        expect(res.payload).not.toContain(leaked);
        expect(res.payload).not.toContain(ghostSub);
      }
    }, 60_000);

    // ------------------------------------- V-12 — the revision term (EARS-34)

    it("046 EARS-34: needs revision on Tuesday 2027-02-16 → stored 2027-02-20T00:00+03:00; on Friday 2027-02-19 → 2027-02-25T00:00+03:00", async () => {
      clock.at = msk("2027-02-10T10:00:00");
      const a = await congress({
        opensAt: msk("2027-02-01T00:00:00"),
        closesAt: msk("2027-02-17T00:00:00"),
      });
      const doc = await author("v12-term");
      await register(doc, a.id);
      const tue = await submitted(doc, a.id, "Вторник");
      const fri = await submitted(doc, a.id, "Пятница");
      const member = await committee("v12-term-m", a.id);

      clock.at = msk("2027-02-16T11:30:00");
      await setStatus(member.headers, a.id, tue, {
        status: "needs_revision",
        expectedStatus: "submitted",
        comment: "Доработать",
      });
      clock.at = msk("2027-02-19T18:00:00");
      await setStatus(member.headers, a.id, fri, {
        status: "needs_revision",
        expectedStatus: "submitted",
        comment: "Доработать",
      });

      expect((await row(tue)).revision_due_at!.toISOString()).toBe(
        msk("2027-02-20T00:00:00").toISOString(),
      );
      expect((await row(fri)).revision_due_at!.toISOString()).toBe(
        msk("2027-02-25T00:00:00").toISOString(),
      );
    }, 60_000);

    it("046 EARS-30, EARS-34: a talk resent on 2027-02-18 after the oral closing returns to submitted with a receipt, not counted twice; from the stored instant autosave and send are refused; the committee then rejects", async () => {
      clock.at = msk("2027-02-10T10:00:00");
      const a = await congress({
        opensAt: msk("2027-02-01T00:00:00"),
        closesAt: msk("2027-02-17T00:00:00"),
        submitLimit: 1,
      });
      const doc = await author("v12-loop");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v12-loop-m", a.id);
      clock.at = msk("2027-02-16T11:30:00");
      await setStatus(member.headers, a.id, id, {
        status: "needs_revision",
        expectedStatus: "submitted",
        comment: "Доработать",
      });

      // 2027-02-18 — the oral intake closed on the 16th; the deadline holds.
      clock.at = msk("2027-02-18T12:00:00");
      const receiptsBefore = mailer.congressSubmissionReceipts.filter(
        (r) => r.to === doc.email,
      ).length;
      const edit = await app.inject({
        method: "PATCH",
        url: `${BASE}/${id}`,
        headers: doc.headers,
        payload: { ...ORAL, title: "Исправленная тема" },
      });
      expect(edit.statusCode, edit.payload).toBe(200);
      const resend = await send(doc, id);
      expect(resend.statusCode, resend.payload).toBe(200);
      expect((await row(id)).status).toBe("submitted");
      await vi.waitFor(
        () =>
          expect(
            mailer.congressSubmissionReceipts.filter((r) => r.to === doc.email)
              .length,
          ).toBe(receiptsBefore + 1),
        { timeout: 5000, interval: 50 },
      );

      // Back to revision, then the stored instant passes.
      await setStatus(member.headers, a.id, id, {
        status: "needs_revision",
        expectedStatus: "submitted",
        comment: "Ещё раз",
      });
      const due = (await row(id)).revision_due_at!;
      clock.at = due;
      const late = await app.inject({
        method: "PATCH",
        url: `${BASE}/${id}`,
        headers: doc.headers,
        payload: { ...ORAL, title: "Поздно" },
      });
      expect(late.statusCode).toBeGreaterThanOrEqual(400);
      expect((await send(doc, id)).statusCode).toBeGreaterThanOrEqual(400);
      expect((await row(id)).status).toBe("needs_revision");

      const reject = await setStatus(member.headers, a.id, id, {
        status: "rejected",
        expectedStatus: "needs_revision",
        comment: "Срок истёк",
      });
      expect(reject.statusCode).toBe(200);
    }, 90_000);

    // ----------------------------------- V-12 — the extension (EARS-35)

    it("046 EARS-35: the administrator extends an expired submission to 2027-03-03 → stored 2027-03-04T00:00+03:00 with the extension letter; resend passes; the audit row is written", async () => {
      clock.at = msk("2027-02-10T10:00:00");
      const a = await congress({
        opensAt: msk("2027-02-01T00:00:00"),
        closesAt: msk("2027-02-17T00:00:00"),
      });
      const doc = await author("v12-ext");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const member = await committee("v12-ext-m", a.id);
      const boss = await platformAdmin("v12-ext-admin");
      clock.at = msk("2027-02-16T11:30:00");
      await setStatus(member.headers, a.id, id, {
        status: "needs_revision",
        expectedStatus: "submitted",
        comment: "Доработать",
      });
      clock.at = msk("2027-02-24T10:00:00"); // expired on the 20th

      const extendUrl = `${cardUrl(a.id, id)}/revision-deadline`;
      // An earlier or equal day, a day before today, and a committee member: refused.
      expect(
        (await admin(boss.headers).post(extendUrl, { lastDay: "2027-02-19" }))
          .statusCode,
      ).toBe(422);
      expect(
        (await admin(boss.headers).post(extendUrl, { lastDay: "2027-02-23" }))
          .statusCode,
      ).toBe(422);
      expect([401, 403]).toContain(
        (await admin(member.headers).post(extendUrl, { lastDay: "2027-03-03" }))
          .statusCode,
      );

      const ok = await admin(boss.headers).post(extendUrl, {
        lastDay: "2027-03-03",
      });
      expect(ok.statusCode, ok.payload).toBe(200);
      const card = CongressSubmissionCardSchema.parse(ok.json());
      expect(card.revisionDueAt).toBe(msk("2027-03-04T00:00:00").toISOString());
      expect(card.revisionLastDay).toBe("2027-03-03");
      expect((await row(id)).status).toBe("needs_revision");

      const recorded = await waitForLetter(id, "revision_extended");
      expect(recorded.last_letter_status).toBe("sent");
      const letter = decisionsTo(doc.email).at(-1)!;
      expect(letter.letter).toBe("revision_extended");
      const rendered = congressSubmissionDecisionMessage({
        title: ORAL.title,
        kindLabel: "Устный доклад",
        letter: "revision_extended",
        lastDay: formatRevisionLastDay(
          (letter as { revisionDueAt: Date }).revisionDueAt,
        ),
      });
      expect(rendered.text).toContain("до 03.03.2027, 23:59 МСК");

      const { rows: audit } = await pool.query<{ actor: string | null }>(
        `SELECT subject_id AS actor FROM audit_ledger
          WHERE metadata->>'table' = 'congress_submissions'
            AND metadata->'pk'->>'id' = $1
            AND metadata->'diff' ? 'revision_due_at'
            AND (metadata->'diff'->'revision_due_at'->>'new')::timestamptz = $2`,
        [id, msk("2027-03-04T00:00:00")],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor).toBe(boss.sub);

      // The author may resend until the new deadline.
      expect((await send(doc, id)).statusCode).toBe(200);
      // …and a submission no longer in revision cannot be extended.
      expect(
        (await admin(boss.headers).post(extendUrl, { lastDay: "2027-03-10" }))
          .statusCode,
      ).toBe(409);
    }, 90_000);

    it("046 EARS-35: a letter failure keeps the extension and records the failed outcome", async () => {
      clock.at = msk("2027-02-10T10:00:00");
      const a = await congress({
        opensAt: msk("2027-02-01T00:00:00"),
        closesAt: msk("2027-02-17T00:00:00"),
      });
      const doc = await author("v12-fail");
      await register(doc, a.id);
      const id = await submitted(doc, a.id);
      const boss = await platformAdmin("v12-fail-admin");
      clock.at = msk("2027-02-16T11:30:00");
      expect(
        (
          await setStatus(boss.headers, a.id, id, {
            status: "needs_revision",
            expectedStatus: "submitted",
            comment: "Доработать",
          })
        ).statusCode,
      ).toBe(200);
      await waitForLetter(id, "needs_revision");
      clock.at = msk("2027-02-24T10:00:00");

      mailer.failNextSubmissionDecision(new Error("relay down"));
      const ok = await admin(boss.headers).post(
        `${cardUrl(a.slug, id)}/revision-deadline`,
        {
          lastDay: "2027-03-03",
        },
      );
      expect(ok.statusCode, ok.payload).toBe(200);
      const recorded = await waitForLetter(id, "revision_extended");
      expect(recorded.last_letter_status).toBe("failed");
      expect(recorded.revision_due_at!.toISOString()).toBe(
        msk("2027-03-04T00:00:00").toISOString(),
      );
    }, 90_000);
  },
);

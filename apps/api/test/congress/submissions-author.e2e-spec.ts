import { createHash, randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { loadDocument } from "@ds/legal-content";
import {
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
  CongressSubmissionRefusalSchema,
  CongressSubmissionSchema,
  CongressSubmissionSectionSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import { congressSubmissionReceiptMessage } from "../../src/mailer/notice-emails.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

/**
 * 046 EARS-5…EARS-13, EARS-16, EARS-17 — the author's congress submissions,
 * `/v1/me/congress-submissions*`, oral kind, and the EARS-14 receipt letter.
 * Verification rows V-3, V-4 (the window, the status and the receipt letter),
 * V-5, V-6 (the limit, oral kind) and V-9.
 *
 * Driven through the REAL routes on the REAL module with a real doctor session;
 * the committee's status changes (their route is a later work package) are
 * written straight to the row, which is exactly the concurrent change the
 * author's conditional withdraw has to lose to.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL or
 * IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const VERSION_A = `2026-10-01.sha256-${"a".repeat(64)}`;
const VERSION_B = `2026-11-01.sha256-${"b".repeat(64)}`;

/**
 * EARS-16 — the version the submission consent must carry: the published
 * consent document's edition plus the sha256 of its text, computed here from
 * the file itself rather than through the api's resolver.
 */
const SUBMISSION_CONSENT_VERSION = (() => {
  const document = loadDocument("consent-congress-submissions");
  if (!document)
    throw new Error("the submission consent document is not published");
  const digest = createHash("sha256").update(document.body).digest("hex");
  return `${document.frontmatter.edition}.sha256-${digest}`;
})();

/** EARS-16 — lets one case take the consent document away (the 503 path). */
const consentDocument = vi.hoisted(() => ({ gone: false }));
vi.mock("../../src/congress/congress-submission-consent.js", async (load) => {
  const actual =
    await load<
      typeof import("../../src/congress/congress-submission-consent.js")
    >();
  return {
    ...actual,
    resolveCongressSubmissionConsentVersion: (
      ...args: Parameters<typeof actual.resolveCongressSubmissionConsentVersion>
    ) =>
      consentDocument.gone
        ? ({ ok: false, reason: "consent-document-missing" } as const)
        : actual.resolveCongressSubmissionConsentVersion(...args),
  };
});
const DAY = 24 * 60 * 60 * 1000;
const BASE = "/v1/me/congress-submissions";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "046 congress submissions — the author's cabinet, oral talks (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const mailer = new FakeMailer();
    const fake = new FakeIdpClient(mailer);
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    type Doctor = {
      headers: Record<string, string>;
      userId: string;
      email: string;
    };

    async function doctor(prefix: string): Promise<Doctor> {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return {
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie!.value}`,
        },
        userId: rows[0]!.id,
        email,
      };
    }

    /** A congress event with its intake settings; the oral window as given. */
    async function congress(
      oral: {
        opensAt: Date | null;
        closesAt: Date | null;
        submitLimit?: number | null;
      },
      startsAt = "2027-04-23T09:00:00.000Z",
      poster: { maxAgeYears: number | null } | null = null,
    ): Promise<string> {
      const id = randomUUID();
      createdEventIds.push(id);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format)
         VALUES ($1,$2,'Конгресс','Конгресс',$4,480,
                 'Ежегодный конгресс.',$3,'sponsor:congress',NULL,'published',
                 'offline')`,
        [id, `congress-sub-${id.slice(0, 8)}`, ["cardiology"], startsAt],
      );
      await pool.query(
        `INSERT INTO congress_submission_settings (event_id, registration_url)
         VALUES ($1, 'https://orthobio.ru/registration')`,
        [id],
      );
      await pool.query(
        `INSERT INTO congress_submission_kind_settings
           (event_id, kind, opens_at, closes_at, submit_limit)
         VALUES ($1, 'oral', $2, $3, $4)`,
        [id, oral.opensAt, oral.closesAt, oral.submitLimit ?? null],
      );
      if (poster) {
        await pool.query(
          `INSERT INTO congress_submission_kind_settings
             (event_id, kind, opens_at, closes_at, submit_limit, max_age_years)
           VALUES ($1, 'poster', $2, $3, NULL, $4)`,
          [id, oral.opensAt, oral.closesAt, poster.maxAgeYears],
        );
      }
      return id;
    }

    const openWindow = () => ({
      opensAt: new Date(Date.now() - DAY),
      closesAt: new Date(Date.now() + 30 * DAY),
    });

    async function closeOral(eventId: string): Promise<void> {
      await pool.query(
        `UPDATE congress_submission_kind_settings
            SET opens_at = $2, closes_at = $3
          WHERE event_id = $1 AND kind = 'oral'`,
        [
          eventId,
          new Date(Date.now() - 2 * DAY),
          new Date(Date.now() - 60_000),
        ],
      );
    }

    async function register(
      d: Doctor,
      eventId: string,
      answers: Record<string, string> | null = null,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO registrations (user_id, event_id, answers) VALUES ($1, $2, $3)`,
        [d.userId, eventId, answers],
      );
    }

    const create = (d: Doctor, eventId: string, kind = "oral") =>
      app.inject({
        method: "POST",
        url: BASE,
        headers: d.headers,
        payload: { eventId, kind },
      });

    const autosave = (d: Doctor, id: string, payload: unknown) =>
      app.inject({
        method: "PATCH",
        url: `${BASE}/${id}`,
        headers: d.headers,
        payload,
      });

    const send = (d: Doctor, id: string, accept = true) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/send`,
        headers: d.headers,
        payload: {
          acceptedConsents: accept
            ? [CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE]
            : [],
        },
      });

    const withdraw = (d: Doctor, id: string, expectedStatus: string) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/withdraw`,
        headers: d.headers,
        payload: { expectedStatus },
      });

    const section = async (d: Doctor, eventId: string) => {
      const res = await app.inject({
        method: "GET",
        url: `${BASE}?event=${eventId}`,
        headers: d.headers,
      });
      expect(res.statusCode).toBe(200);
      return CongressSubmissionSectionSchema.parse(res.json());
    };

    const completeOral = {
      title: "Эндопротезирование коленного сустава",
      authors: [
        {
          surname: "иванова",
          firstName: "мария",
          patronymic: "петровна",
          workplace: "ГКБ №1",
          presenting: true,
        },
      ],
      body: { goal: "Разобрать показания.", summary: "Краткое содержание." },
    };

    /** A complete oral draft, ready to send. */
    async function readyDraft(d: Doctor, eventId: string): Promise<string> {
      const created = await create(d, eventId);
      expect(created.statusCode).toBe(201);
      const id = CongressSubmissionSchema.parse(created.json()).id;
      expect((await autosave(d, id, completeOral)).statusCode).toBe(200);
      return id;
    }

    async function setStatus(id: string, status: string): Promise<void> {
      await pool.query(
        "UPDATE congress_submissions SET status = $2 WHERE id = $1",
        [id, status],
      );
    }

    async function statusOf(id: string): Promise<string> {
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM congress_submissions WHERE id = $1",
        [id],
      );
      return rows[0]!.status;
    }

    const codes = (res: { json: () => unknown }) =>
      CongressSubmissionRefusalSchema.parse(res.json()).problems.map(
        (p) => p.code,
      );

    beforeAll(async () => {
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = VERSION_A;
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(MAILER)
        .useValue(mailer)
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

    afterAll(async () => {
      process.env.CONGRESS_SIGNUP_CONSENT_VERSION = VERSION_A;
      if (pool) {
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
        for (const id of createdEventIds.splice(0))
          await deleteEventFixture(pool, id);
      }
      await app?.close();
    });

    // ------------------------------------------------------------------ V-3

    it("EARS-5: without an active registration the section says so and creating a submission is refused", async () => {
      const d = await doctor("sub-noreg");
      const eventId = await congress(openWindow());

      const s = await section(d, eventId);
      expect(s.registered).toBe(false);
      expect(s.registrationUrl).toBe("https://orthobio.ru/registration");
      expect(s.submissions).toEqual([]);

      const refused = await create(d, eventId);
      expect(refused.statusCode).toBe(422);
      expect(codes(refused)).toEqual(["registration-required"]);
      const { rows } = await pool.query(
        "SELECT 1 FROM congress_submissions WHERE user_id = $1",
        [d.userId],
      );
      expect(rows).toHaveLength(0);
    });

    it("EARS-5: a guest is refused and an event without intake settings has no section", async () => {
      const guest = await app.inject({
        method: "GET",
        url: `${BASE}?event=${randomUUID()}`,
      });
      expect(guest.statusCode).toBe(401);
      const d = await doctor("sub-nosettings");
      const none = await app.inject({
        method: "GET",
        url: `${BASE}?event=${randomUUID()}`,
        headers: d.headers,
      });
      expect(none.statusCode).toBe(404);
    });

    it("EARS-4: without an event the section resolves the latest congress event and names it for the heading", async () => {
      const d = await doctor("sub-noevent");
      const eventId = await congress(openWindow(), "2099-04-23T09:00:00.000Z");
      await register(d, eventId);

      const res = await app.inject({
        method: "GET",
        url: BASE,
        headers: d.headers,
      });
      expect(res.statusCode, res.payload).toBe(200);
      const s = CongressSubmissionSectionSchema.parse(res.json());
      expect(s.eventId).toBe(eventId);
      expect(s.registered).toBe(true);
      expect(s.event).toEqual({
        slug: `congress-sub-${eventId.slice(0, 8)}`,
        title: "Конгресс",
        startsAt: "2099-04-23T09:00:00.000Z",
        endsAt: "2099-04-23T17:00:00.000Z",
      });
    });

    it("EARS-6: a registered participant's draft is owned by the account, linked to the registration, author 1 prefilled from the answers", async () => {
      const d = await doctor("sub-prefill");
      const eventId = await congress(openWindow());
      await register(d, eventId, {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        workplace: "ГКБ №1",
      });

      const created = await create(d, eventId);
      expect(created.statusCode).toBe(201);
      const draft = CongressSubmissionSchema.parse(created.json());
      expect(draft.status).toBe("draft");
      expect(draft.kind).toBe("oral");
      expect(draft.authors).toEqual([
        {
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          workplace: "ГКБ №1",
          presenting: true,
        },
      ]);
      const { rows } = await pool.query<{ user_id: string; reg_user: string }>(
        `SELECT s.user_id, r.user_id AS reg_user
           FROM congress_submissions s JOIN registrations r ON r.id = s.registration_id
          WHERE s.id = $1`,
        [draft.id],
      );
      expect(rows[0]).toEqual({ user_id: d.userId, reg_user: d.userId });
    });

    it("EARS-6: without registration answers author 1's name is left empty (the display name is never split); creating is refused only after the closing instant", async () => {
      const d = await doctor("sub-display");
      await pool.query(
        "UPDATE users SET display_name = 'Мария Иванова' WHERE id = $1",
        [d.userId],
      );
      const future = await congress({
        opensAt: new Date(Date.now() + 5 * DAY),
        closesAt: new Date(Date.now() + 30 * DAY),
      });
      await register(d, future);
      const early = await create(d, future);
      expect(early.statusCode).toBe(201);
      expect(CongressSubmissionSchema.parse(early.json()).authors[0]).toEqual({
        presenting: true,
      });

      const closed = await congress(openWindow());
      await register(d, closed);
      await closeOral(closed);
      const late = await create(d, closed);
      expect(late.statusCode).toBe(422);
      expect(codes(late)).toEqual(["kind-closed"]);
    });

    it("046 EARS-21: every kind's form is offered — an abstract draft is created with no presenting mark", async () => {
      const d = await doctor("sub-kind-abstract");
      const eventId = await congress(openWindow());
      await register(d, eventId, {
        surname: "Иванова",
        firstName: "Мария",
        workplace: "ГКБ №1",
      });
      const created = await create(d, eventId, "abstract");
      expect(created.statusCode, created.payload).toBe(201);
      const draft = CongressSubmissionSchema.parse(created.json());
      expect(draft).toMatchObject({
        kind: "abstract",
        status: "draft",
        derivedFromId: null,
        statements: null,
      });
      expect(draft.authors[0]!.presenting).toBe(false);
      const s = await section(d, eventId);
      expect(s.kinds.every((k) => k.offered)).toBe(true);
    });

    it("EARS-7: an autosave stores incomplete content, enforces maximum lengths, and is refused on a submitted submission", async () => {
      const d = await doctor("sub-autosave");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = CongressSubmissionSchema.parse(
        (await create(d, eventId)).json(),
      ).id;

      const partial = await autosave(d, id, {
        title: "Черно",
        body: { goal: "" },
      });
      expect(partial.statusCode).toBe(200);
      expect(CongressSubmissionSchema.parse(partial.json())).toMatchObject({
        title: "Черно",
        body: { goal: "" },
        status: "draft",
      });

      const tooLong = await autosave(d, id, { title: "т".repeat(301) });
      expect(tooLong.statusCode).toBe(400);
      const wrongKey = await autosave(d, id, { body: { content: "x" } });
      expect(wrongKey.statusCode).toBe(400);

      expect((await autosave(d, id, completeOral)).statusCode).toBe(200);
      expect((await send(d, id)).statusCode).toBe(200);
      const refused = await autosave(d, id, { title: "Другая тема" });
      expect(refused.statusCode).toBe(409);
      expect(codes(refused)).toEqual(["status-conflict"]);
    });

    it("EARS-11: the section lists the account's submissions with kind, title, status, last change and revision deadline — and nobody else's", async () => {
      const d = await doctor("sub-list");
      const other = await doctor("sub-list-other");
      const eventId = await congress({ ...openWindow(), submitLimit: 3 });
      await register(d, eventId);
      await register(other, eventId);
      const mine = await readyDraft(d, eventId);
      await readyDraft(other, eventId);
      await pool.query(
        `UPDATE congress_submissions
            SET status = 'needs_revision', committee_comment = 'Уточните цель',
                revision_due_at = '2027-02-20T00:00:00+03:00', submitted_at = now(),
                status_changed_at = '2027-02-10T12:30:00+03:00'
          WHERE id = $1`,
        [mine],
      );

      const s = await section(d, eventId);
      expect(s.registered).toBe(true);
      expect(s.submissions).toHaveLength(1);
      expect(s.submissions[0]).toMatchObject({
        id: mine,
        kind: "oral",
        title: completeOral.title,
        status: "needs_revision",
        committeeComment: "Уточните цель",
      });
      expect(Date.parse(s.submissions[0]!.revisionDueAt!)).toBe(
        Date.parse("2027-02-20T00:00:00+03:00"),
      );
      expect(s.submissions[0]!.updatedAt).toBeTruthy();
      // The committee comment is dated by the status change that carried it.
      expect(Date.parse(s.submissions[0]!.statusChangedAt)).toBe(
        Date.parse("2027-02-10T12:30:00+03:00"),
      );
      const oral = s.kinds.find((k) => k.kind === "oral")!;
      expect(oral).toMatchObject({
        state: "open",
        submitLimit: 3,
        used: 1,
        offered: true,
      });

      const foreign = await autosave(other, mine, { title: "чужая" });
      expect(foreign.statusCode).toBe(404);
    });

    // ------------------------------------------------------------------ V-4

    it("EARS-9: a send before opening, with an empty opening or after closing is refused with the state and changes nothing", async () => {
      const d = await doctor("sub-window");
      const notYet = await congress({
        opensAt: new Date(Date.now() + 5 * DAY),
        closesAt: new Date(Date.now() + 30 * DAY),
      });
      const unannounced = await congress({ opensAt: null, closesAt: null });
      const closed = await congress(openWindow());
      for (const e of [notYet, unannounced, closed]) await register(d, e);

      const a = await readyDraft(d, notYet);
      const b = await readyDraft(d, unannounced);
      const c = await readyDraft(d, closed);
      await closeOral(closed);

      const early = await send(d, a);
      expect(early.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(early.json()).problems,
      ).toEqual([
        { code: "kind-not-open", params: { opensAt: expect.any(String) } },
      ]);
      const none = await send(d, b);
      expect(none.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(none.json()).problems,
      ).toEqual([{ code: "kind-not-open", params: { opensAt: null } }]);
      const late = await send(d, c);
      expect(late.statusCode).toBe(422);
      expect(codes(late)).toEqual(["kind-closed"]);

      for (const id of [a, b, c]) expect(await statusOf(id)).toBe("draft");
      const { rows } = await pool.query(
        "SELECT 1 FROM consent_records WHERE user_id = $1 AND purpose = $2",
        [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
      );
      expect(rows).toHaveLength(0);
    });

    it("EARS-9: an incomplete draft is refused with every unmet field named; inside the window a complete one becomes submitted with the send instant", async () => {
      const d = await doctor("sub-send");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = CongressSubmissionSchema.parse(
        (await create(d, eventId)).json(),
      ).id;
      await autosave(d, id, { title: "", authors: [], body: { goal: "Цель" } });

      const incomplete = await send(d, id);
      expect(incomplete.statusCode).toBe(422);
      const fields = CongressSubmissionRefusalSchema.parse(incomplete.json())
        .problems.filter((p) => p.code === "field-invalid")
        .map((p) => p.field);
      expect(fields).toEqual(
        expect.arrayContaining(["title", "authors", "body.summary"]),
      );
      expect(await statusOf(id)).toBe("draft");

      await autosave(d, id, completeOral);
      const before = Date.now();
      const sent = await send(d, id);
      expect(sent.statusCode).toBe(200);
      const body = CongressSubmissionSchema.parse(sent.json());
      expect(body.status).toBe("submitted");
      expect(Date.parse(body.submittedAt!)).toBeGreaterThanOrEqual(
        before - 1000,
      );
      // EARS-8 — names are normalised by the 044 EARS-33 rule on send.
      expect(body.authors[0]).toMatchObject({
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
      });
    });

    // ------------------------------------------------ V-4 — the receipt letter

    type LetterOutcome = {
      kind: string | null;
      status: string | null;
      at: Date | null;
    };

    async function letterOf(id: string): Promise<LetterOutcome> {
      const { rows } = await pool.query<LetterOutcome>(
        `SELECT last_letter_kind AS kind, last_letter_status AS status,
                last_letter_at AS at
           FROM congress_submissions WHERE id = $1`,
        [id],
      );
      return rows[0]!;
    }

    /** The receipt is sent off the response path — poll for its outcome. */
    async function waitForLetter(id: string): Promise<LetterOutcome> {
      return vi.waitFor(
        async () => {
          const outcome = await letterOf(id);
          expect(outcome.status).not.toBeNull();
          return outcome;
        },
        { timeout: 5000, interval: 50 },
      );
    }

    const receiptsTo = (email: string) =>
      mailer.congressSubmissionReceipts.filter((r) => r.to === email);

    it("EARS-14: after the send commits the author gets the receipt naming the kind, title and event with the absolute cabinet link, and the outcome is recorded", async () => {
      const d = await doctor("sub-receipt");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);

      const before = Date.now();
      const sent = await send(d, id);
      expect(sent.statusCode).toBe(200);

      const outcome = await waitForLetter(id);
      expect(outcome).toMatchObject({ kind: "receipt", status: "sent" });
      expect(outcome.at!.getTime()).toBeGreaterThanOrEqual(before - 1000);

      const cabinetUrl = `${process.env.MAILER_DOCTOR_BASE_URL!.replace(/\/+$/, "")}/account/congress`;
      expect(cabinetUrl).toMatch(/^https?:\/\//);
      const [receipt] = receiptsTo(d.email.toLowerCase());
      expect(receipt).toEqual({
        email: d.email,
        to: d.email.toLowerCase(),
        title: completeOral.title,
        kindLabel: "Устный доклад",
        eventTitle: "Конгресс",
        cabinetUrl,
      });
      const message = congressSubmissionReceiptMessage(receipt!);
      expect(message.text).toContain(
        `Ваша заявка «${completeOral.title}» (устный доклад) получена и ` +
          "передана программному комитету Конгресс.",
      );
      expect(message.text).toContain(`Мои заявки на Конгресс: ${cabinetUrl}`);
    });

    it("EARS-14: a mail failure keeps the submission submitted and records the outcome failed", async () => {
      const d = await doctor("sub-receipt-fail");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);

      mailer.failNextSubmissionReceipt(new Error("relay down"));
      const sent = await send(d, id);
      expect(sent.statusCode).toBe(200);
      expect(CongressSubmissionSchema.parse(sent.json()).status).toBe(
        "submitted",
      );

      const outcome = await waitForLetter(id);
      expect(outcome).toMatchObject({ kind: "receipt", status: "failed" });
      expect(await statusOf(id)).toBe("submitted");
      expect(receiptsTo(d.email.toLowerCase())).toHaveLength(0);
    });

    // ------------------------------------------------------------------ V-5

    it("EARS-16: the first send requires the submission consent and records one row with the consent document's version; a second send does not; a new edition asks again", async () => {
      const d = await doctor("sub-consent");
      const e1 = await congress(openWindow());
      const e2 = await congress(openWindow());
      await register(d, e1);
      await register(d, e2);

      expect((await section(d, e1)).consentRequired).toBe(true);
      const first = await readyDraft(d, e1);
      const refused = await send(d, first, false);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json()).problems,
      ).toEqual([
        {
          code: "consent-required",
          params: { purpose: CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE },
        },
      ]);
      expect((await send(d, first)).statusCode).toBe(200);

      const rows = async () =>
        (
          await pool.query<{ version: string }>(
            "SELECT version FROM consent_records WHERE user_id = $1 AND purpose = $2 ORDER BY captured_at",
            [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
          )
        ).rows.map((r) => r.version);
      // The consent document's own version — not the congress registration
      // consent setting (044 EARS-9), which versions a different text.
      expect(await rows()).toEqual([SUBMISSION_CONSENT_VERSION]);
      expect(SUBMISSION_CONSENT_VERSION).not.toBe(VERSION_A);

      // Another event, same account and version: no second acceptance.
      expect((await section(d, e2)).consentRequired).toBe(false);
      const second = await readyDraft(d, e2);
      expect((await send(d, second, false)).statusCode).toBe(200);
      expect(await rows()).toEqual([SUBMISSION_CONSENT_VERSION]);
    });

    it("046 EARS-16: consent given under an earlier edition of the document is asked again at the next send", async () => {
      const d = await doctor("sub-consent-edition");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const earlier = `2026-01-01.sha256-${"e".repeat(64)}`;
      await pool.query(
        "INSERT INTO consent_records (user_id, purpose, version) VALUES ($1, $2, $3)",
        [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE, earlier],
      );

      expect((await section(d, eventId)).consentRequired).toBe(true);
      const id = await readyDraft(d, eventId);
      const again = await send(d, id, false);
      expect(again.statusCode).toBe(422);
      expect(codes(again)).toEqual(["consent-required"]);
      expect((await send(d, id)).statusCode).toBe(200);
      const { rows } = await pool.query<{ version: string }>(
        "SELECT version FROM consent_records WHERE user_id = $1 AND purpose = $2 ORDER BY captured_at",
        [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
      );
      expect(rows.map((r) => r.version)).toEqual([
        earlier,
        SUBMISSION_CONSENT_VERSION,
      ]);
    });

    it("046 EARS-16: two parallel first sends of one account (different events) record one consent row", async () => {
      const d = await doctor("sub-consent-race");
      const e1 = await congress(openWindow());
      const e2 = await congress(openWindow());
      await register(d, e1);
      await register(d, e2);
      const a = await readyDraft(d, e1);
      const b = await readyDraft(d, e2);
      const results = await Promise.all([send(d, a), send(d, b)]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
      const { rows } = await pool.query(
        "SELECT 1 FROM consent_records WHERE user_id = $1 AND purpose = $2",
        [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
      );
      expect(rows).toHaveLength(1);
    });

    it("046 EARS-16: the store keeps one submission-consent row per account and version, whichever path writes it; other purposes are untouched", async () => {
      const d = await doctor("sub-consent-unique");
      const insert = (purpose: string, version: string) =>
        pool.query(
          "INSERT INTO consent_records (user_id, purpose, version) VALUES ($1, $2, $3)",
          [d.userId, purpose, version],
        );
      await insert(CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE, VERSION_A);
      await expect(
        insert(CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE, VERSION_A),
      ).rejects.toMatchObject({ code: "23505" });
      await insert(CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE, VERSION_B);
      await insert("sub-consent-unique-other-purpose", VERSION_A);
      await insert("sub-consent-unique-other-purpose", VERSION_A);
      const { rows } = await pool.query(
        "SELECT purpose FROM consent_records WHERE user_id = $1 AND purpose = ANY($2)",
        [
          d.userId,
          [
            CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
            "sub-consent-unique-other-purpose",
          ],
        ],
      );
      expect(rows).toHaveLength(4);
    });

    it("046 EARS-16: without a published consent document the section still reads (consent asked) and only the send is refused", async () => {
      const d = await doctor("sub-consent-unset");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      consentDocument.gone = true;
      try {
        const read = await section(d, eventId);
        expect(read.consentRequired).toBe(true);
        expect(read.submissions.map((s) => s.id)).toEqual([id]);
        expect((await send(d, id)).statusCode).toBe(503);
        expect(await statusOf(id)).toBe("draft");
      } finally {
        consentDocument.gone = false;
      }
    });

    // ------------------------------------------------------------------ V-6

    it("EARS-17: rejected and withdrawn submissions count toward the limit, drafts and one returned to draft do not", async () => {
      const d = await doctor("sub-limit");
      const eventId = await congress({ ...openWindow(), submitLimit: 2 });
      await register(d, eventId);
      const a = await readyDraft(d, eventId);
      const b = await readyDraft(d, eventId);
      const c = await readyDraft(d, eventId);

      expect((await send(d, a)).statusCode).toBe(200);
      await setStatus(a, "rejected");
      expect((await send(d, b)).statusCode).toBe(200);

      const full = await send(d, c);
      expect(full.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(full.json()).problems,
      ).toEqual([{ code: "limit-reached", params: { limit: 2 } }]);

      // b back to draft: it no longer counts, so c fits.
      expect((await withdraw(d, b, "submitted")).statusCode).toBe(200);
      expect(await statusOf(b)).toBe("draft");
      expect((await send(d, c)).statusCode).toBe(200);

      // c withdrawn for good still counts: b cannot take the slot back.
      await setStatus(c, "in_review");
      expect((await withdraw(d, c, "in_review")).statusCode).toBe(200);
      expect(await statusOf(c)).toBe("withdrawn");
      const stillFull = await send(d, b);
      expect(stillFull.statusCode).toBe(422);
      expect(codes(stillFull)).toEqual(["limit-reached"]);
    });

    it("EARS-17: two parallel sends for the last slot admit exactly one", async () => {
      const d = await doctor("sub-race");
      const eventId = await congress({ ...openWindow(), submitLimit: 1 });
      await register(d, eventId);
      const a = await readyDraft(d, eventId);
      const b = await readyDraft(d, eventId);

      const results = await Promise.all([send(d, a), send(d, b)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 422]);
      const { rows } = await pool.query(
        "SELECT 1 FROM congress_submissions WHERE user_id = $1 AND status = 'submitted'",
        [d.userId],
      );
      expect(rows).toHaveLength(1);
    });

    // ----------------------------------------------- V-12 — the author resend

    /** The committee's `needs_revision` with a deadline, as S5 will set it. */
    async function needsRevision(id: string, dueAt: Date): Promise<void> {
      await pool.query(
        `UPDATE congress_submissions
            SET status = 'needs_revision', committee_comment = 'Уточните цель',
                revision_due_at = $2, last_letter_kind = NULL,
                last_letter_status = NULL, last_letter_at = NULL
          WHERE id = $1`,
        [id, dueAt],
      );
    }

    it("046 EARS-9: a needs_revision talk resent before its revision deadline — after the oral closing — becomes submitted with a new receipt, is not counted against the limit a second time and takes no second consent", async () => {
      const d = await doctor("sub-resend");
      const eventId = await congress({ ...openWindow(), submitLimit: 1 });
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      expect((await send(d, id)).statusCode).toBe(200);
      await waitForLetter(id);

      await needsRevision(id, new Date(Date.now() + 2 * DAY));
      await closeOral(eventId);
      const edited = await autosave(d, id, {
        body: {
          goal: "Разобрать показания и осложнения.",
          summary: "Краткое содержание.",
        },
      });
      expect(edited.statusCode).toBe(200);

      const before = Date.now();
      const resent = await send(d, id, false);
      expect(resent.statusCode).toBe(200);
      const body = CongressSubmissionSchema.parse(resent.json());
      expect(body.status).toBe("submitted");
      expect(Date.parse(body.submittedAt!)).toBeGreaterThanOrEqual(
        before - 1000,
      );

      const outcome = await waitForLetter(id);
      expect(outcome).toMatchObject({ kind: "receipt", status: "sent" });
      expect(receiptsTo(d.email.toLowerCase())).toHaveLength(2);

      const oral = (await section(d, eventId)).kinds.find(
        (k) => k.kind === "oral",
      )!;
      expect(oral.used).toBe(1);
      const { rows } = await pool.query(
        "SELECT 1 FROM consent_records WHERE user_id = $1 AND purpose = $2",
        [d.userId, CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE],
      );
      expect(rows).toHaveLength(1);
    });

    it("046 EARS-30: from the revision deadline the send is refused with revision-closed, autosave is refused, and the status stays needs_revision", async () => {
      const d = await doctor("sub-resend-late");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      expect((await send(d, id)).statusCode).toBe(200);
      await waitForLetter(id);

      const dueAt = new Date(Date.now() - 60_000);
      await needsRevision(id, dueAt);
      const sentBefore = receiptsTo(d.email.toLowerCase()).length;

      const late = await send(d, id);
      expect(late.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(late.json()).problems,
      ).toEqual([
        {
          code: "revision-closed",
          params: { revisionDueAt: dueAt.toISOString() },
        },
      ]);
      expect((await autosave(d, id, { title: "Другое" })).statusCode).toBe(409);
      expect(await statusOf(id)).toBe("needs_revision");
      expect(receiptsTo(d.email.toLowerCase())).toHaveLength(sentBefore);
    });

    it("046 EARS-9: statuses other than draft and needs_revision cannot be sent", async () => {
      const d = await doctor("sub-send-status");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      expect((await send(d, id)).statusCode).toBe(200);
      for (const status of [
        "submitted",
        "in_review",
        "accepted",
        "rejected",
        "withdrawn",
      ]) {
        await setStatus(id, status);
        const refused = await send(d, id);
        expect(refused.statusCode).toBe(409);
        expect(codes(refused)).toEqual(["status-conflict"]);
      }
    });

    // ------------------------------------------------------------------ V-9

    it("EARS-12: withdrawing in_review, needs_revision, or submitted after closing sets withdrawn — read-only, never sent again", async () => {
      const d = await doctor("sub-withdraw");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const inReview = await readyDraft(d, eventId);
      const revision = await readyDraft(d, eventId);
      const late = await readyDraft(d, eventId);
      for (const id of [inReview, revision, late])
        expect((await send(d, id)).statusCode).toBe(200);
      await setStatus(inReview, "in_review");
      await setStatus(revision, "needs_revision");
      await closeOral(eventId);

      for (const [id, seen] of [
        [inReview, "in_review"],
        [revision, "needs_revision"],
        [late, "submitted"],
      ] as const) {
        const res = await withdraw(d, id, seen);
        expect(res.statusCode).toBe(200);
        expect(CongressSubmissionSchema.parse(res.json()).status).toBe(
          "withdrawn",
        );
      }

      const resend = await send(d, late);
      expect(resend.statusCode).toBe(409);
      expect(codes(resend)).toEqual(["status-conflict"]);
      expect((await autosave(d, late, { title: "x" })).statusCode).toBe(409);
    });

    it("EARS-12: accepted, rejected, withdrawn and draft submissions cannot be withdrawn", async () => {
      const d = await doctor("sub-nowithdraw");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const draft = await readyDraft(d, eventId);
      const refusedDraft = await withdraw(d, draft, "draft");
      expect(refusedDraft.statusCode).toBe(409);
      expect(codes(refusedDraft)).toEqual(["withdraw-not-allowed"]);

      for (const status of ["accepted", "rejected", "withdrawn"]) {
        const id = await readyDraft(d, eventId);
        expect((await send(d, id)).statusCode).toBe(200);
        await setStatus(id, status);
        const res = await withdraw(d, id, status);
        expect(res.statusCode).toBe(409);
        expect(codes(res)).toEqual(["withdraw-not-allowed"]);
        expect(await statusOf(id)).toBe(status);
      }
    });

    it("EARS-12: a take-back racing a committee change to in_review loses — the row stays in_review", async () => {
      const d = await doctor("sub-racewd");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      expect((await send(d, id)).statusCode).toBe(200);
      // The author saw `submitted`; the committee commits `in_review` first.
      await setStatus(id, "in_review");

      const res = await withdraw(d, id, "submitted");
      expect(res.statusCode).toBe(409);
      expect(
        CongressSubmissionRefusalSchema.parse(res.json()).problems,
      ).toEqual([
        { code: "withdraw-not-allowed", params: { status: "in_review" } },
      ]);
      expect(await statusOf(id)).toBe("in_review");
    });

    it("EARS-13: a draft may be deleted; a submitted submission may not", async () => {
      const d = await doctor("sub-delete");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const draft = await readyDraft(d, eventId);
      const sent = await readyDraft(d, eventId);
      expect((await send(d, sent)).statusCode).toBe(200);

      const del = (id: string) =>
        app.inject({
          method: "DELETE",
          url: `${BASE}/${id}`,
          headers: d.headers,
        });
      expect((await del(draft)).statusCode).toBe(204);
      // ADR-0003 §3.6 — the row is retired, not removed, and gone for the author.
      const { rows } = await pool.query<{ record_status: string }>(
        "SELECT record_status FROM congress_submissions WHERE id = $1",
        [draft],
      );
      expect(rows).toEqual([{ record_status: "retired" }]);
      expect((await section(d, eventId)).submissions.map((s) => s.id)).toEqual([
        sent,
      ]);
      expect((await autosave(d, draft, { title: "x" })).statusCode).toBe(404);
      expect((await del(draft)).statusCode).toBe(404);

      const refused = await del(sent);
      expect(refused.statusCode).toBe(409);
      expect(codes(refused)).toEqual(["status-conflict"]);
      expect(await statusOf(sent)).toBe("submitted");
    });

    // ------------------------------------------------------------------ V-7

    const putBirthDate = (headers: Record<string, string>, payload: unknown) =>
      app.inject({
        method: "PUT",
        url: "/v1/me/birth-date",
        headers,
        payload,
      });

    const birthDateOf = async (userId: string) => {
      const { rows } = await pool.query<{ birth_date: string | null }>(
        "SELECT to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM users WHERE id = $1",
        [userId],
      );
      return rows[0]!.birth_date;
    };

    const completePoster = {
      title: "Ревизионное эндопротезирование",
      authors: completeOral.authors,
      body: { goal: "Показать результаты.", content: "Содержание постера." },
    };

    const posterCongress = (maxAgeYears: number | null = 40) =>
      congress(openWindow(), "2027-04-23T09:00:00.000Z", { maxAgeYears });

    it("046 EARS-19: the holder writes the birth date through PUT /v1/me/birth-date, it is validated, and the section shows it back to them", async () => {
      const d = await doctor("sub-birth");
      const eventId = await posterCongress();
      expect((await section(d, eventId)).birthDate).toBeNull();

      const ok = await putBirthDate(d.headers, { birthDate: "1987-04-24" });
      expect(ok.statusCode, ok.payload).toBe(200);
      expect(ok.json()).toEqual({ birthDate: "1987-04-24" });
      expect(ok.headers["cache-control"]).toBe("no-store");
      expect(await birthDateOf(d.userId)).toBe("1987-04-24");
      expect((await section(d, eventId)).birthDate).toBe("1987-04-24");

      // Corrected by the holder — the account keeps one value.
      expect(
        (await putBirthDate(d.headers, { birthDate: "1987-04-23" })).statusCode,
      ).toBe(200);
      expect(await birthDateOf(d.userId)).toBe("1987-04-23");

      for (const birthDate of [
        "1987-02-30",
        "24.04.1987",
        "1899-12-31",
        "2999-01-01",
        null,
      ]) {
        const bad = await putBirthDate(d.headers, { birthDate });
        expect(bad.statusCode, String(birthDate)).toBe(400);
      }
      expect(
        (await putBirthDate(d.headers, { birthDate: "1987-04-24", x: 1 }))
          .statusCode,
      ).toBe(400);
      expect(await birthDateOf(d.userId)).toBe("1987-04-23");
    });

    it("046 EARS-19: a guest cannot write a birth date", async () => {
      const guest = await putBirthDate(device, { birthDate: "1987-04-24" });
      expect(guest.statusCode).toBe(401);
    });

    it("046 EARS-19: a poster draft is created without a birth date; its send names the missing birth date until it is stored", async () => {
      const d = await doctor("sub-poster-nobd");
      const eventId = await posterCongress();
      await register(d, eventId);

      const created = await create(d, eventId, "poster");
      expect(created.statusCode, created.payload).toBe(201);
      const id = CongressSubmissionSchema.parse(created.json()).id;
      expect((await autosave(d, id, completePoster)).statusCode).toBe(200);

      const refused = await send(d, id);
      expect(refused.statusCode).toBe(422);
      expect(CongressSubmissionRefusalSchema.parse(refused.json())).toEqual({
        problems: [{ code: "field-invalid", field: "birthDate" }],
      });
      expect(await statusOf(id)).toBe("draft");

      await putBirthDate(d.headers, { birthDate: "1987-04-24" });
      const sent = await send(d, id);
      expect(sent.statusCode, sent.payload).toBe(200);
    });

    it("046 EARS-18: a poster has no presenting author — it is not set at creation, and a poster without the holder's row sends", async () => {
      const d = await doctor("sub-poster-nopresent");
      const eventId = await posterCongress();
      await register(d, eventId);
      await putBirthDate(d.headers, { birthDate: "1990-01-01" });
      const poster = CongressSubmissionSchema.parse(
        (await create(d, eventId, "poster")).json(),
      );
      expect(poster.authors.map((a) => a.presenting ?? false)).toEqual([false]);

      const coAuthor = {
        surname: "Петрова",
        firstName: "Анна",
        workplace: "НМИЦ ТО им. Н. Н. Приорова",
      };
      expect(
        (
          await autosave(d, poster.id, {
            ...completePoster,
            authors: [coAuthor],
          })
        ).statusCode,
      ).toBe(200);
      const sent = await send(d, poster.id);
      expect(sent.statusCode, sent.payload).toBe(200);
      expect(
        CongressSubmissionSchema.parse(sent.json()).authors.map(
          (a) => a.presenting ?? false,
        ),
      ).toEqual([false]);
    });

    it("046 EARS-20: born 1987-04-23 is refused a poster for the 2027-04-23 congress with the limit, the start day and the age; 1987-04-24 is allowed; oral stays available", async () => {
      const d = await doctor("sub-poster-age");
      const eventId = await posterCongress(40);
      await register(d, eventId);
      await putBirthDate(d.headers, { birthDate: "1987-04-23" });

      const refused = await create(d, eventId, "poster");
      expect(refused.statusCode).toBe(422);
      expect(CongressSubmissionRefusalSchema.parse(refused.json())).toEqual({
        problems: [
          {
            code: "age-limit",
            params: { maxAgeYears: 40, eventStartDate: "2027-04-23", age: 40 },
          },
        ],
      });
      expect((await section(d, eventId)).submissions).toEqual([]);
      expect((await create(d, eventId, "oral")).statusCode).toBe(201);

      await putBirthDate(d.headers, { birthDate: "1987-04-24" });
      const created = await create(d, eventId, "poster");
      expect(created.statusCode).toBe(201);
      const poster = CongressSubmissionSchema.parse(created.json());
      expect(poster.kind).toBe("poster");
      const kinds = (await section(d, eventId)).kinds;
      expect(kinds.find((k) => k.kind === "poster")).toMatchObject({
        offered: true,
        maxAgeYears: 40,
      });
      expect(kinds.find((k) => k.kind === "oral")?.maxAgeYears).toBeNull();
    });

    it("046 EARS-20: the age rule is checked again at send — a birth date corrected over the limit refuses it and changes nothing", async () => {
      const d = await doctor("sub-poster-send");
      const eventId = await posterCongress(40);
      await register(d, eventId);
      await putBirthDate(d.headers, { birthDate: "1987-04-24" });
      const created = await create(d, eventId, "poster");
      const id = CongressSubmissionSchema.parse(created.json()).id;
      expect((await autosave(d, id, completePoster)).statusCode).toBe(200);

      await putBirthDate(d.headers, { birthDate: "1987-04-23" });
      const refused = await send(d, id);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json()).problems,
      ).toEqual([
        {
          code: "age-limit",
          params: { maxAgeYears: 40, eventStartDate: "2027-04-23", age: 40 },
        },
      ]);
      expect(await statusOf(id)).toBe("draft");

      await putBirthDate(d.headers, { birthDate: "1987-04-24" });
      const sent = await send(d, id);
      expect(sent.statusCode, sent.payload).toBe(200);
      expect(CongressSubmissionSchema.parse(sent.json())).toMatchObject({
        status: "submitted",
        body: completePoster.body,
      });
    });

    it("046 EARS-18: a poster send names its missing goal and content; a file field is not accepted", async () => {
      const d = await doctor("sub-poster-fields");
      const eventId = await posterCongress(40);
      await register(d, eventId);
      await putBirthDate(d.headers, { birthDate: "1990-01-01" });
      const id = CongressSubmissionSchema.parse(
        (await create(d, eventId, "poster")).json(),
      ).id;
      expect(
        (await autosave(d, id, { ...completePoster, body: { file: "p.pdf" } }))
          .statusCode,
      ).toBe(400);
      expect(
        (await autosave(d, id, { ...completePoster, body: {} })).statusCode,
      ).toBe(200);
      const refused = await send(d, id);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json())
          .problems.map((p) => p.field)
          .sort(),
      ).toEqual(["body.content", "body.goal"]);
    });

    it("046 EARS-20: a kind with no age limit has no age rule", async () => {
      const d = await doctor("sub-poster-nolimit");
      const eventId = await posterCongress(null);
      await register(d, eventId);
      await putBirthDate(d.headers, { birthDate: "1950-01-01" });
      expect((await create(d, eventId, "poster")).statusCode).toBe(201);
    });

    // ------------------------------------------- V-1, V-6, V-8 — abstracts

    /** A congress whose abstract intake is open with the given limit and rule. */
    async function abstractCongress(
      submitLimit: number | null = 3,
      firstAuthorCounts = false,
    ): Promise<string> {
      const eventId = await congress(openWindow());
      const w = openWindow();
      await pool.query(
        `INSERT INTO congress_submission_kind_settings
           (event_id, kind, opens_at, closes_at, submit_limit)
         VALUES ($1, 'abstract', $2, $3, $4)`,
        [eventId, w.opensAt, w.closesAt, submitLimit],
      );
      await pool.query(
        `UPDATE congress_submission_settings SET first_author_counts = $2
          WHERE event_id = $1`,
        [eventId, firstAuthorCounts],
      );
      return eventId;
    }

    const abstractSections = {
      relevance: "Гонартроз остаётся частой причиной боли.",
      goal: "Оценить комбинацию PRP и гиалуроновой кислоты.",
      methods: "Проспективное исследование, 120 пациентов.",
      results: "Боль по ВАШ снизилась на 40 %.",
      conclusions: "Комбинация эффективна.",
    };

    const abstractAuthor = (surname = "Иванова") => ({
      surname,
      firstName: "Мария",
      patronymic: "Петровна",
      workplace: "ГКБ №1",
    });

    const sendAbstract = (
      d: Doctor,
      id: string,
      statements: string[] = ["plag", "trade"],
      accept = true,
    ) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/send`,
        headers: d.headers,
        payload: {
          acceptedConsents: accept
            ? [CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE]
            : [],
          statements,
        },
      });

    /** A complete abstract draft with the given first author, ready to send. */
    async function readyAbstract(
      d: Doctor,
      eventId: string,
      first: Record<string, string> = abstractAuthor(),
    ): Promise<string> {
      const created = await create(d, eventId, "abstract");
      expect(created.statusCode, created.payload).toBe(201);
      const id = CongressSubmissionSchema.parse(created.json()).id;
      const saved = await autosave(d, id, {
        title: "PRP и гиалуроновая кислота при гонартрозе",
        authors: [first, abstractAuthor("Петров")],
        body: abstractSections,
      });
      expect(saved.statusCode, saved.payload).toBe(200);
      return id;
    }

    it("046 EARS-21: an abstract send names each empty section; 5000 characters exactly — a CRLF counted as one — sends", async () => {
      const d = await doctor("sub-abs-len");
      const eventId = await abstractCongress();
      await register(d, eventId);
      const id = await readyAbstract(d, eventId);

      const others =
        abstractSections.relevance.length +
        abstractSections.goal.length +
        abstractSections.methods.length +
        abstractSections.conclusions.length;
      expect(
        (
          await autosave(d, id, {
            body: { ...abstractSections, goal: "  ", conclusions: "" },
          })
        ).statusCode,
      ).toBe(200);
      const refused = await sendAbstract(d, id);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json())
          .problems.map((p) => p.field)
          .sort(),
      ).toEqual(["body.conclusions", "body.goal"]);
      expect(await statusOf(id)).toBe("draft");

      // Spaces and line breaks count, a CRLF as one line break: this text is
      // 5000 characters by the rule (5001 UTF-16 units) and sends.
      const body = {
        ...abstractSections,
        results: "р".repeat(5000 - others - 2) + "\r\nр",
      };
      expect((await autosave(d, id, { body })).statusCode).toBe(200);
      const sent = await sendAbstract(d, id);
      expect(sent.statusCode, sent.payload).toBe(200);
      expect(CongressSubmissionSchema.parse(sent.json()).status).toBe(
        "submitted",
      );
    });

    it("046 EARS-21: 5001 characters together are refused with the server's count", async () => {
      const d = await doctor("sub-abs-5001");
      const eventId = await abstractCongress();
      await register(d, eventId);
      const id = await readyAbstract(d, eventId);
      const others =
        abstractSections.relevance.length +
        abstractSections.goal.length +
        abstractSections.methods.length +
        abstractSections.conclusions.length;
      expect(
        (
          await autosave(d, id, {
            body: { ...abstractSections, results: "р".repeat(5001 - others) },
          })
        ).statusCode,
      ).toBe(200);
      const refused = await sendAbstract(d, id);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json()).problems,
      ).toEqual([
        {
          code: "field-invalid",
          field: "body",
          params: { length: 5001, max: 5000 },
        },
      ]);
    });

    it("046 EARS-22: the abstract contract takes plain-text sections only — no other field", async () => {
      const d = await doctor("sub-abs-plain");
      const eventId = await abstractCongress();
      await register(d, eventId);
      const id = await readyAbstract(d, eventId);
      for (const body of [
        { image: "data:image/png;base64,AAAA" },
        { results: { table: [["a", "b"]] } },
      ]) {
        expect((await autosave(d, id, { body })).statusCode).toBe(400);
      }
    });

    it("046 EARS-23: an abstract send without a statement is refused naming each one, and no consent other than the submission consent is asked", async () => {
      const d = await doctor("sub-abs-stmt");
      const eventId = await abstractCongress();
      await register(d, eventId);
      const id = await readyAbstract(d, eventId);

      const none = await sendAbstract(d, id, [], false);
      expect(none.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(none.json()).problems,
      ).toEqual([
        { code: "statement-required", params: { statement: "plag" } },
        { code: "statement-required", params: { statement: "trade" } },
        {
          code: "consent-required",
          params: { purpose: CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE },
        },
      ]);
      const one = await sendAbstract(d, id, ["plag"]);
      expect(one.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(one.json()).problems,
      ).toEqual([
        { code: "statement-required", params: { statement: "trade" } },
      ]);
      expect(await statusOf(id)).toBe("draft");

      const before = Date.now();
      const sent = await sendAbstract(d, id);
      expect(sent.statusCode, sent.payload).toBe(200);
      const view = CongressSubmissionSchema.parse(sent.json());
      expect(Object.keys(view.statements ?? {}).sort()).toEqual([
        "plag",
        "trade",
      ]);
      const { rows } = await pool.query<{
        statements: Record<string, string>;
      }>("SELECT statements FROM congress_submissions WHERE id = $1", [id]);
      for (const at of Object.values(rows[0]!.statements)) {
        expect(new Date(at).getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(new Date(at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
      // One consent — the submission consent — and nothing written for the
      // publication of the abstracts (it is covered by that consent).
      const consents = await pool.query<{ purpose: string }>(
        "SELECT purpose FROM consent_records WHERE user_id = $1 AND purpose <> 'tos'",
        [d.userId],
      );
      expect(consents.rows.map((r) => r.purpose)).toEqual([
        CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
      ]);
    });

    it("046 EARS-23: an oral talk takes no statements", async () => {
      const d = await doctor("sub-oral-stmt");
      const eventId = await congress(openWindow());
      await register(d, eventId);
      const id = await readyDraft(d, eventId);
      const sent = await send(d, id);
      expect(sent.statusCode, sent.payload).toBe(200);
      expect(CongressSubmissionSchema.parse(sent.json()).statements).toBeNull();
    });

    it("046 EARS-17: abstract limit 3 — rejected and withdrawn count, a draft and one returned to draft do not; the fourth send is refused", async () => {
      const d = await doctor("sub-abs-limit");
      const eventId = await abstractCongress(3);
      await register(d, eventId);
      const ids = [];
      for (let i = 0; i < 5; i += 1) ids.push(await readyAbstract(d, eventId));
      const [a, b, c, e, f] = ids as [string, string, string, string, string];

      for (const id of [a, b, c])
        expect((await sendAbstract(d, id)).statusCode).toBe(200);
      await setStatus(a, "rejected");
      await setStatus(b, "withdrawn");
      // c back to draft: it does not count, so e takes the third slot.
      expect((await withdraw(d, c, "submitted")).statusCode).toBe(200);
      expect((await sendAbstract(d, e)).statusCode).toBe(200);

      const fourth = await sendAbstract(d, f);
      expect(fourth.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(fourth.json()).problems,
      ).toEqual([{ code: "limit-reached", params: { limit: 3 } }]);
      // Two parallel fourth sends admit none.
      const both = await Promise.all([sendAbstract(d, c), sendAbstract(d, f)]);
      expect(both.map((r) => r.statusCode)).toEqual([422, 422]);
      const s = await section(d, eventId);
      expect(s.kinds.find((k) => k.kind === "abstract")?.used).toBe(3);
    });

    it("046 EARS-24: first-author rule on — a second submitter whose first author has the same normalised name is refused at the limit; a draft does not count; another first author and the rule off pass", async () => {
      const eventId = await abstractCongress(3, true);
      const one = await doctor("sub-fa-one");
      const two = await doctor("sub-fa-two");
      await register(one, eventId);
      await register(two, eventId);

      // Two sent by one submitter, one rejected (still counted), one draft.
      const a = await readyAbstract(one, eventId);
      const b = await readyAbstract(one, eventId);
      expect((await sendAbstract(one, a)).statusCode).toBe(200);
      expect((await sendAbstract(one, b)).statusCode).toBe(200);
      await setStatus(b, "rejected");
      await readyAbstract(one, eventId);
      const c = await readyAbstract(two, eventId, {
        ...abstractAuthor(),
        surname: "  иванова ",
        firstName: "МАРИЯ",
      });
      expect((await sendAbstract(two, c)).statusCode).toBe(200);

      // Three counted with Иванова Мария Петровна first: the fourth is refused.
      const fourth = await readyAbstract(two, eventId);
      const refused = await sendAbstract(two, fourth);
      expect(refused.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(refused.json()).problems,
      ).toEqual([
        {
          code: "first-author-limit-reached",
          params: {
            limit: 3,
            used: 3,
            firstAuthor: "Иванова Мария Петровна",
          },
        },
      ]);
      expect(await statusOf(fourth)).toBe("draft");

      // Another first author (no patronymic is another name) passes.
      const other = await readyAbstract(two, eventId, {
        surname: "Иванова",
        firstName: "Мария",
        workplace: "ГКБ №1",
      });
      expect((await sendAbstract(two, other)).statusCode).toBe(200);

      // The rule off: the same first author passes.
      await pool.query(
        "UPDATE congress_submission_settings SET first_author_counts = false WHERE event_id = $1",
        [eventId],
      );
      expect((await sendAbstract(two, fourth)).statusCode).toBe(200);
    });

    it("046 EARS-24: two parallel sends by different submitters for the first author's last slot admit exactly one", async () => {
      const eventId = await abstractCongress(1, true);
      const one = await doctor("sub-fa-race-one");
      const two = await doctor("sub-fa-race-two");
      await register(one, eventId);
      await register(two, eventId);
      const a = await readyAbstract(one, eventId);
      const b = await readyAbstract(two, eventId);
      const results = await Promise.all([
        sendAbstract(one, a),
        sendAbstract(two, b),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    });

    const createFrom = (d: Doctor, eventId: string, derivedFromId: string) =>
      app.inject({
        method: "POST",
        url: BASE,
        headers: d.headers,
        payload: { eventId, kind: "abstract", derivedFromId },
      });

    it("046 EARS-25: «Подать тезисы по этой работе» on a sent oral talk creates an abstract draft with its title and authors, linked to it", async () => {
      const d = await doctor("sub-abs-from");
      const eventId = await abstractCongress();
      await register(d, eventId);
      const talk = await readyDraft(d, eventId);
      expect((await send(d, talk)).statusCode).toBe(200);
      await setStatus(talk, "accepted");

      const created = await createFrom(d, eventId, talk);
      expect(created.statusCode, created.payload).toBe(201);
      const draft = CongressSubmissionSchema.parse(created.json());
      expect(draft).toMatchObject({
        kind: "abstract",
        status: "draft",
        derivedFromId: talk,
        title: completeOral.title,
        body: {},
      });
      expect(draft.authors).toEqual([
        {
          surname: "Иванова",
          firstName: "Мария",
          patronymic: "Петровна",
          workplace: "ГКБ №1",
          presenting: false,
        },
      ]);
      const { rows } = await pool.query<{ derived_from_id: string }>(
        "SELECT derived_from_id FROM congress_submissions WHERE id = $1",
        [draft.id],
      );
      expect(rows[0]!.derived_from_id).toBe(talk);
    });

    it("046 EARS-25: the action is refused on a draft or a withdrawn talk, on abstracts, for another kind, and on another account's work", async () => {
      const d = await doctor("sub-abs-from-no");
      const stranger = await doctor("sub-abs-from-stranger");
      const eventId = await abstractCongress();
      await register(d, eventId);
      await register(stranger, eventId);

      const draftTalk = await readyDraft(d, eventId);
      const refusedDraft = await createFrom(d, eventId, draftTalk);
      expect(refusedDraft.statusCode).toBe(409);
      expect(codes(refusedDraft)).toEqual(["status-conflict"]);

      const withdrawnTalk = await readyDraft(d, eventId);
      expect((await send(d, withdrawnTalk)).statusCode).toBe(200);
      await setStatus(withdrawnTalk, "withdrawn");
      expect((await createFrom(d, eventId, withdrawnTalk)).statusCode).toBe(
        409,
      );

      const sentAbstract = await readyAbstract(d, eventId);
      expect((await sendAbstract(d, sentAbstract)).statusCode).toBe(200);
      const fromAbstract = await createFrom(d, eventId, sentAbstract);
      expect(fromAbstract.statusCode).toBe(422);
      expect(
        CongressSubmissionRefusalSchema.parse(fromAbstract.json()).problems,
      ).toEqual([{ code: "field-invalid", field: "derivedFromId" }]);

      const sentTalk = await readyDraft(d, eventId);
      expect((await send(d, sentTalk)).statusCode).toBe(200);
      const asOral = await app.inject({
        method: "POST",
        url: BASE,
        headers: d.headers,
        payload: { eventId, kind: "oral", derivedFromId: sentTalk },
      });
      expect(asOral.statusCode).toBe(422);
      expect(codes(asOral)).toEqual(["field-invalid"]);

      expect((await createFrom(stranger, eventId, sentTalk)).statusCode).toBe(
        404,
      );
    });
  },
);

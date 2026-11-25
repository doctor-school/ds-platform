import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  AdminApplicationDetailSchema,
  AdminApplicationListPageSchema,
  AdminApplicationNoteSchema,
  APPLICATION_NOTE_ERASED_SENTINEL,
  AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

/**
 * 033 EARS-13…EARS-17, EARS-20 (admin action) — the admin «Заявки» API
 * (#4030) over the REAL stack: the cursor-paged list with its kind and status
 * filters, the detail with the account's CURRENT contact, the status moves
 * with their outcome rule under `If-Match`, the append-only notes, the
 * erasure on request, the platform_admin + second factor + CSRF +
 * idempotency floor of every route and the 010 audit row of every change.
 *
 * Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
 * or IDP_ISSUER is absent so the shared CI unit job stays green.
 */

const BASE = "/v1/admin/applications";
const DAY = 24 * 60 * 60 * 1000;
const CONSENT_VERSION = "2026-11.sha256-test";

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "033 EARS-13…EARS-17, EARS-20 — admin application queue (e2e)",
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
    const createdApplications: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;
    let adminUserId: string;
    let adminSub: string;
    /** Every row this suite writes sits in the far future, so it heads the list. */
    let clock = Date.now() + 3650 * DAY;

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

    /** An applicant account written directly — it never signs in here. */
    async function applicant(name: string | null = "Ирина Ортопед") {
      const email = uniqueEmail("app-admin-applicant");
      const phone = `+7999${Math.floor(Math.random() * 1e7)
        .toString()
        .padStart(7, "0")}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (zitadel_sub, email, phone, display_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [`app-admin-${randomUUID()}`, email, phone, name],
      );
      return { id: rows[0]!.id, email, phone };
    }

    async function stored(
      userId: string,
      over: {
        status?: "new" | "in_review" | "closed";
        teamNotice?: "pending" | "sent" | "failed" | "skipped";
        payload?: Record<string, unknown>;
      } = {},
    ): Promise<string> {
      const status = over.status ?? "new";
      clock += 1000;
      const { rows: c } = await pool.query<{ id: string }>(
        `INSERT INTO consent_records (user_id, purpose, version)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE, CONSENT_VERSION],
      );
      const payload = over.payload ?? {
        topic: "Ведение пациентов с гонартрозом",
        format: "course_series",
        about: "Практикующий ортопед",
      };
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO applications
           (kind, status, outcome, applicant_user_id, payload, subject_line,
            consent_record_id, consent_purpose, consent_version_tag,
            idempotency_key, submitted_at, team_notice, receipt_notice,
            status_changed_at, closed_at)
         VALUES ('author', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sent', $12, $13)
         RETURNING id`,
        [
          status,
          status === "closed" ? "declined" : null,
          userId,
          JSON.stringify(payload),
          payload.topic,
          c[0]!.id,
          AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
          CONSENT_VERSION,
          randomUUID(),
          new Date(clock),
          over.teamNotice ?? "sent",
          status === "new" ? null : new Date(clock),
          status === "closed" ? new Date(clock) : null,
        ],
      );
      createdApplications.push(rows[0]!.id);
      return rows[0]!.id;
    }

    const admin = (extra: Record<string, string> = {}) => ({
      ...device,
      ...adminHeaders(adminSid),
      ...extra,
    });

    const list = (query = "") =>
      app.inject({ method: "GET", url: `${BASE}${query}`, headers: admin() });

    const detail = (id: string) =>
      app.inject({ method: "GET", url: `${BASE}/${id}`, headers: admin() });

    const move = (
      id: string,
      payload: Record<string, unknown>,
      ifMatch: string | null,
      k: string = key(),
    ) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/status`,
        headers: admin({
          "content-type": "application/json",
          "idempotency-key": k,
          ...(ifMatch === null ? {} : { "if-match": ifMatch }),
        }),
        payload,
      });

    const addNote = (id: string, body: unknown, k: string = key()) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/notes`,
        headers: admin({
          "content-type": "application/json",
          "idempotency-key": k,
        }),
        payload: { body } as Record<string, unknown>,
      });

    const erase = (id: string, k: string = key()) =>
      app.inject({
        method: "POST",
        url: `${BASE}/${id}/erase-personal-data`,
        headers: admin({
          "content-type": "application/json",
          "idempotency-key": k,
        }),
        payload: {},
      });

    const etagOf = async (id: string) => {
      const res = await detail(id);
      expect(res.statusCode, res.payload).toBe(200);
      return String(res.headers.etag);
    };

    const errorCode = (res: { json: () => unknown }) =>
      (res.json() as { errorCode?: string }).errorCode;

    async function row(id: string) {
      const { rows } = await pool.query<{
        status: string;
        outcome: string | null;
        status_changed_at: Date | null;
        status_changed_by: string | null;
        closed_at: Date | null;
        version: number;
        pd_erased_at: Date | null;
        payload: unknown;
        applicant_user_id: string | null;
      }>("SELECT * FROM applications WHERE id = $1", [id]);
      return rows[0]!;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("app-admin"),
        password,
        consent,
      });
      adminSub = sub;
      await fake.grantProjectRole(sub, "platform_admin");
      adminSid = (
        await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        })
      ).sid;
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE zitadel_sub = $1",
        [sub],
      );
      adminUserId = rows[0]!.id;
    });

    afterAll(async () => {
      if (pool) {
        for (const id of createdApplications.splice(0)) {
          await pool.query(
            "DELETE FROM application_notes WHERE application_id = $1",
            [id],
          );
          await pool.query("DELETE FROM applications WHERE id = $1", [id]);
        }
        for (const k of usedKeys.splice(0))
          await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
        for (const email of createdEmails.splice(0))
          await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    // ------------------------------------------------------------- EARS-13

    it("EARS-13: the list shows every application newest first with kind, time, applicant, subject line, status with outcome and the «Команда не уведомлена» mark", async () => {
      const a = await applicant("Анна Список");
      const older = await stored(a.id, { teamNotice: "failed" });
      const newer = await stored(a.id, { status: "closed" });

      const res = await list();
      expect(res.statusCode, res.payload).toBe(200);
      const page = AdminApplicationListPageSchema.parse(res.json());
      // The «Вид» filter reads its options and labels from the same kinds
      // table the rows' labels come from (033-design «Request kinds»).
      expect(page.kinds).toEqual([{ kind: "author", label: "Автор" }]);
      const ids = page.items.map((i) => i.id);
      expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
      expect(ids.indexOf(newer)).toBeGreaterThanOrEqual(0);

      const first = page.items.find((i) => i.id === newer)!;
      expect(first).toMatchObject({
        kind: "author",
        kindLabel: "Автор",
        applicant: "Анна Список",
        subjectLine: "Ведение пациентов с гонартрозом",
        status: "closed",
        outcome: "declined",
        teamNotified: true,
        erased: false,
      });
      const second = page.items.find((i) => i.id === older)!;
      expect(second.teamNotified).toBe(false);
      expect(second.outcome).toBeNull();
    });

    it("EARS-13: the kind and status filters narrow the list, the cursor pages it without skipping or repeating, and a filter with no match is an empty page", async () => {
      const a = await applicant();
      const mine = [
        await stored(a.id),
        await stored(a.id, { status: "in_review" }),
        await stored(a.id),
      ].reverse();

      const byStatus = AdminApplicationListPageSchema.parse(
        (await list("?kind=author&status=in_review")).json(),
      );
      expect(byStatus.items.every((i) => i.status === "in_review")).toBe(true);
      expect(byStatus.items.map((i) => i.id)).toContain(mine[1]);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 3; i++) {
        const res = await list(
          `?kind=author&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(res.statusCode, res.payload).toBe(200);
        const page = AdminApplicationListPageSchema.parse(res.json());
        expect(page.items).toHaveLength(1);
        seen.push(page.items[0]!.id);
        cursor = page.nextCursor;
        expect(cursor).not.toBeNull();
      }
      expect(seen).toEqual(mine);

      const badCursor = await list("?cursor=not-a-cursor");
      expect(badCursor.statusCode).toBe(400);
      const badKind = await list("?kind=unknown");
      expect(badKind.statusCode).toBe(400);
    });

    // ------------------------------------------------------------- EARS-14

    it("EARS-14: the detail shows the fields with their labels, the consent, the notification outcomes, the account's CURRENT contact and the notes oldest first; an unknown id is 404", async () => {
      const a = await applicant("Старое Имя");
      const id = await stored(a.id, {
        payload: {
          topic: "Тема детали",
          format: "podcast",
          specialtyOther: "Спортивная медицина",
          about: "О себе",
        },
      });
      await pool.query("UPDATE users SET display_name = $1 WHERE id = $2", [
        "Новое Имя",
        a.id,
      ]);
      expect((await addNote(id, "первая")).statusCode).toBe(201);
      expect((await addNote(id, "вторая")).statusCode).toBe(201);

      const res = await detail(id);
      expect(res.statusCode, res.payload).toBe(200);
      const d = AdminApplicationDetailSchema.parse(res.json());
      expect(res.headers.etag).toBe(`W/"${d.version}"`);
      expect(d.fields).toEqual([
        { key: "topic", label: "Тема", value: "Тема детали" },
        { key: "format", label: "Формат", value: "Подкаст" },
        {
          key: "specialty",
          label: "Специальность",
          value: "Другое: Спортивная медицина",
        },
        { key: "about", label: "О себе", value: "О себе" },
      ]);
      expect(d.applicant).toEqual({
        type: "account",
        userId: a.id,
        displayName: "Новое Имя",
        email: a.email,
        phone: a.phone,
      });
      expect(d.consent).toMatchObject({
        purpose: AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
        versionTag: CONSENT_VERSION,
      });
      expect(d.consent.capturedAt).not.toBeNull();
      expect(d.teamNotice).toBe("sent");
      expect(d.receiptNotice).toBe("sent");
      expect(d.notes.map((n) => n.body)).toEqual(["первая", "вторая"]);
      expect(d.notes[0]!.authorAdminId).toBe(adminUserId);

      const unknown = await detail(randomUUID());
      expect(unknown.statusCode).toBe(404);
      const malformed = await detail("not-a-uuid");
      expect(malformed.statusCode).toBe(404);
    });

    it("EARS-14: an author application's detail lists the subject's other applications", async () => {
      const a = await applicant();
      const one = await stored(a.id);
      const two = await stored(a.id);
      const d = AdminApplicationDetailSchema.parse((await detail(one)).json());
      expect(d.otherApplications.map((o) => o.id)).toEqual([two]);
    });

    // ------------------------------------------------------------- EARS-15

    it("EARS-15: new → in_review → closed with an outcome is stored with the acting administrator and the time under If-Match", async () => {
      const a = await applicant();
      const id = await stored(a.id);

      const toReview = await move(
        id,
        { status: "in_review" },
        await etagOf(id),
      );
      expect(toReview.statusCode, toReview.payload).toBe(200);
      const reviewed = AdminApplicationDetailSchema.parse(toReview.json());
      expect(reviewed.status).toBe("in_review");
      expect(toReview.headers.etag).toBe(`W/"${reviewed.version}"`);
      let r = await row(id);
      expect(r.status_changed_by).toBe(adminUserId);
      expect(r.status_changed_at).toBeInstanceOf(Date);

      const toClosed = await move(
        id,
        { status: "closed", outcome: "accepted" },
        String(toReview.headers.etag),
      );
      expect(toClosed.statusCode, toClosed.payload).toBe(200);
      r = await row(id);
      expect(r.status).toBe("closed");
      expect(r.outcome).toBe("accepted");
      expect(r.closed_at).toBeInstanceOf(Date);
      expect(r.status_changed_by).toBe(adminUserId);

      const direct = await stored(a.id);
      const closeNew = await move(
        direct,
        { status: "closed", outcome: "declined" },
        await etagOf(direct),
      );
      expect(closeNew.statusCode, closeNew.payload).toBe(200);
      expect((await row(direct)).outcome).toBe("declined");
    });

    it("EARS-15: any other transition is 409 APPLICATION_TRANSITION_NOT_ALLOWED, a missing or extra outcome 400, `expired` 400, a stale version 412 and a missing If-Match 428 — changing nothing", async () => {
      const a = await applicant();
      const closed = await stored(a.id, { status: "closed" });
      const before = await row(closed);
      const reopen = await move(
        closed,
        { status: "in_review" },
        await etagOf(closed),
      );
      expect(reopen.statusCode).toBe(409);
      expect(errorCode(reopen)).toBe("APPLICATION_TRANSITION_NOT_ALLOWED");

      const reviewing = await stored(a.id, { status: "in_review" });
      const again = await move(
        reviewing,
        { status: "in_review" },
        await etagOf(reviewing),
      );
      expect(again.statusCode).toBe(409);

      const fresh = await stored(a.id);
      const etag = await etagOf(fresh);
      expect((await move(fresh, { status: "closed" }, etag)).statusCode).toBe(
        400,
      );
      expect(
        (await move(fresh, { status: "in_review", outcome: "accepted" }, etag))
          .statusCode,
      ).toBe(400);
      expect(
        (await move(fresh, { status: "closed", outcome: "expired" }, etag))
          .statusCode,
      ).toBe(400);
      expect(
        (await move(fresh, { status: "in_review" }, `W/"999"`)).statusCode,
      ).toBe(412);
      expect(
        (await move(fresh, { status: "in_review" }, null)).statusCode,
      ).toBe(428);
      expect((await row(fresh)).status).toBe("new");
      expect((await row(fresh)).version).toBe(1);
      expect((await row(closed)).version).toBe(before.version);
    });

    // ------------------------------------------------------------- EARS-16

    it("EARS-16: a note is appended trimmed with its author and time; a blank or over-long note is refused 400", async () => {
      const a = await applicant();
      const id = await stored(a.id);
      const res = await addNote(id, "   позвонить в понедельник  ");
      expect(res.statusCode, res.payload).toBe(201);
      const n = AdminApplicationNoteSchema.parse(res.json());
      expect(n.body).toBe("позвонить в понедельник");
      expect(n.authorAdminId).toBe(adminUserId);

      expect((await addNote(id, "   ")).statusCode).toBe(400);
      expect((await addNote(id, "я".repeat(2001))).statusCode).toBe(400);
      expect((await addNote(randomUUID(), "кому")).statusCode).toBe(404);

      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM application_notes WHERE application_id = $1",
        [id],
      );
      expect(rows[0]!.n).toBe("1");
    });

    // ------------------------------------------------------------- EARS-17

    it("EARS-17: every admin application endpoint refuses an anonymous caller and a doctor session server-side, changing nothing", async () => {
      const a = await applicant();
      const id = await stored(a.id);
      const doctorEmail = uniqueEmail("app-admin-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: doctorEmail, password, consent },
      });
      const cookie = await signIn(app, doctorEmail, password, { device });

      for (const [method, url] of [
        ["GET", BASE],
        ["GET", `${BASE}/${id}`],
        ["POST", `${BASE}/${id}/status`],
        ["POST", `${BASE}/${id}/notes`],
        ["POST", `${BASE}/${id}/erase-personal-data`],
      ] as const) {
        const payload =
          method === "GET" ? undefined : { status: "in_review", body: "x" };
        const anon = await app.inject({
          method,
          url,
          headers: {
            ...device,
            "content-type": "application/json",
            "idempotency-key": key(),
            "if-match": 'W/"1"',
          },
          payload,
        });
        expect(anon.statusCode, `${method} ${url}`).toBe(401);
        const doctor = await app.inject({
          method,
          url,
          headers: {
            ...device,
            "content-type": "application/json",
            "idempotency-key": key(),
            "if-match": 'W/"1"',
          },
          cookies: { [SESSION_COOKIE_NAME]: cookie },
          payload,
        });
        expect([401, 403], `${method} ${url}`).toContain(doctor.statusCode);
      }
      const r = await row(id);
      expect(r.status).toBe("new");
      expect(r.pd_erased_at).toBeNull();
    });

    it("EARS-17: a mutation without a canonical Idempotency-Key is refused, and an exact retry replays the stored outcome once", async () => {
      const a = await applicant();
      const id = await stored(a.id);
      const noKey = await app.inject({
        method: "POST",
        url: `${BASE}/${id}/notes`,
        headers: admin({ "content-type": "application/json" }),
        payload: { body: "без ключа" },
      });
      expect(noKey.statusCode).toBe(428);
      expect((await addNote(id, "плохой ключ", "nope")).statusCode).toBe(400);

      const k = key();
      const first = await addNote(id, "один раз", k);
      const second = await addNote(id, "один раз", k);
      expect(second.statusCode).toBe(201);
      expect(second.json()).toEqual(first.json());

      const etag = await etagOf(id);
      const mk = key();
      const m1 = await move(id, { status: "in_review" }, etag, mk);
      const m2 = await move(id, { status: "in_review" }, etag, mk);
      expect(m1.statusCode).toBe(200);
      expect(m2.statusCode).toBe(200);
      expect((await row(id)).version).toBe(2);

      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM application_notes WHERE application_id = $1",
        [id],
      );
      expect(rows[0]!.n).toBe("1");
    });

    it("EARS-17: every status move, note and erasure leaves a 010 audit row attributed to the acting administrator", async () => {
      const a = await applicant();
      const id = await stored(a.id);
      const since = new Date();
      expect(
        (await move(id, { status: "in_review" }, await etagOf(id))).statusCode,
      ).toBe(200);
      const note = AdminApplicationNoteSchema.parse(
        (await addNote(id, "в аудит")).json(),
      );
      expect((await erase(id)).statusCode).toBe(200);

      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE created_at >= $3
            AND ((event_type LIKE 'data.applications.%' AND metadata -> 'pk' ->> 'id' = $1)
              OR (event_type LIKE 'data.application_notes.%' AND metadata -> 'pk' ->> 'id' = $2))
          ORDER BY created_at, event_type`,
        [id, note.id, since],
      );
      // The fixture's own direct insert is not an administrator change.
      const changes = rows.filter(
        (r) => r.event_type !== "data.applications.insert",
      );
      // status move + erasure on the application, the note's insert + its erasure.
      expect(changes.map((r) => r.event_type).sort()).toEqual([
        "data.application_notes.insert",
        "data.application_notes.update",
        "data.applications.update",
        "data.applications.update",
      ]);
      expect(changes.every((r) => r.subject_id === adminSub)).toBe(true);
    });

    // ------------------------------------------------------------- EARS-20

    it("EARS-20: the erasure on request leaves the tombstone shown as erased, refuses a second erasure 409 ALREADY_ERASED and a note on the erased application", async () => {
      const a = await applicant("Стираемый");
      const id = await stored(a.id, { status: "in_review" });
      await addNote(id, "персональная заметка");

      const res = await erase(id);
      expect(res.statusCode, res.payload).toBe(200);
      const d = AdminApplicationDetailSchema.parse(res.json());
      expect(d.erased).toBe(true);
      expect(d.fields).toEqual([]);
      expect(d.applicant).toBeNull();
      expect(d.subjectLine).toBeNull();
      expect(d.status).toBe("in_review");
      expect(d.notes.map((n) => n.body)).toEqual([
        APPLICATION_NOTE_ERASED_SENTINEL,
      ]);
      const r = await row(id);
      expect(r.payload).toEqual({ erased: true });
      expect(r.applicant_user_id).toBeNull();

      const listed = AdminApplicationListPageSchema.parse(
        (await list("?status=in_review")).json(),
      ).items.find((i) => i.id === id)!;
      expect(listed).toMatchObject({
        erased: true,
        applicant: null,
        subjectLine: null,
      });

      const again = await erase(id);
      expect(again.statusCode).toBe(409);
      expect(errorCode(again)).toBe("ALREADY_ERASED");
      const lateNote = await addNote(id, "после стирания");
      expect(lateNote.statusCode).toBe(409);
      expect(errorCode(lateNote)).toBe("ALREADY_ERASED");
      expect((await erase(randomUUID())).statusCode).toBe(404);
    });
  },
);

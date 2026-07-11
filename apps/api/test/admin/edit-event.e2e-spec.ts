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
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-2 — UpdateEvent (PATCH /v1/admin/events/:id) + replaceable program
// PDF. A platform_admin edits an event's fields at any pre-archive state and the
// public event page (004) reflects the edit; replacing the program PDF after
// publish supersedes the stored object reference so the 004 page serves the
// CURRENT file and the superseded file is no longer served; the operator never
// unpublishes to correct a detail (there is no unpublish — an edit is not a state
// reversal). platform_admin-only (EARS-8) — a doctor_guest / public caller is
// refused. Runs against the dev-stand Postgres + MinIO + the fake IdP for the
// session; skips when those are absent so the shared CI unit job stays green
// (requirements Verification, row 2).
describe.skipIf(
  !process.env.DATABASE_URL ||
    !process.env.IDP_ISSUER ||
    !process.env.S3_ENDPOINT,
)("007 EARS-2 edit event + replaceable program PDF (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let storage: ObjectStorage;
  const fake = new FakeIdpClient();
  const password = "Aa1!ufficiently-long-pw";
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const createdEmails: string[] = [];
  const createdEventIds: string[] = [];

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  /** Register + login; return the session cookie value. `role` is granted before login. */
  async function session(
    email: string,
    role: "doctor_guest" | "platform_admin",
  ): Promise<string> {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);

    if (role === "platform_admin") {
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
    }

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    return cookie!.value;
  }

  /** Build a multipart/form-data body from string fields + one optional file part. */
  function multipartBody(
    fields: Record<string, string>,
    file?: {
      field: string;
      filename: string;
      contentType: string;
      body: Buffer;
    },
  ): { body: Buffer; contentType: string } {
    const boundary = `----ds589${Math.random().toString(16).slice(2)}`;
    const chunks: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
        ),
      );
    }
    if (file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(file.body);
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      body: Buffer.concat(chunks),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  const validPayload = {
    title: "Актуальная терапия ХСН",
    school: "Кардиология сегодня",
    startsAtMsk: "2026-07-17T19:00",
    durationMin: 90,
    description: "Разбор клинических рекомендаций.",
    speakers: [
      { name: "Иванов И.И.", regalia: "д.м.н., профессор" },
      { name: "Петрова А.С.", regalia: "к.м.н." },
    ],
    specialties: ["cardiology", "therapy"],
    partnerRef: "sponsor:acme-pharma",
  };

  const pdfV1 = Buffer.from("%PDF-1.4\nV1 program\n%%EOF");
  const pdfV2 = Buffer.from(
    "%PDF-1.4\nV2 revised program — often changes\n%%EOF",
  );

  function admHeaders(cookie: string, contentType: string) {
    return {
      ...device,
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
      "content-type": contentType,
    };
  }

  /** Create an event (with the V1 PDF) and return its `EventAdminDetail`. */
  async function createEvent(
    cookie: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const mp = multipartBody(
      { payload: JSON.stringify({ ...validPayload, ...overrides }) },
      {
        field: "programPdf",
        filename: "program.pdf",
        contentType: "application/pdf",
        body: pdfV1,
      },
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: admHeaders(cookie, mp.contentType),
      payload: mp.body,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    createdEventIds.push(body.id as string);
    return body;
  }

  /** Move an event through a lifecycle transition via the generic guard endpoint. */
  async function transition(
    cookie: string,
    id: string,
    to: string,
  ): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/events/${id}/transition`,
      headers: admHeaders(cookie, "application/json"),
      payload: { to },
    });
    expect(res.statusCode).toBe(200);
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
    await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
    storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  });

  afterEach(async () => {
    for (const id of createdEventIds.splice(0))
      await pool.query("DELETE FROM events WHERE id = $1", [id]);
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-2: editing a published event persists the change and surfaces it on the 004 public event page — with no unpublish (state stays published)", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    const slug = created.slug as string;
    await transition(cookie, id, "published");

    const edit = multipartBody({
      payload: JSON.stringify({
        title: "Актуальная терапия ХСН — обновлено",
        description: "Уточнённая программа.",
        startsAtMsk: "2026-07-17T20:30",
        durationMin: 120,
        speakers: [{ name: "Сидоров П.П.", regalia: "д.м.н." }],
      }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, edit.contentType),
      payload: edit.body,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    // The edit persisted onto the aggregate…
    expect(body.title).toBe("Актуальная терапия ХСН — обновлено");
    expect(body.description).toBe("Уточнённая программа.");
    expect(body.durationMin).toBe(120);
    // …МСК re-entry folded into one canonical instant (20:30 МСК == 17:30Z).
    expect(body.startsAt).toBe("2026-07-17T17:30:00.000Z");
    // …speakers replaced as an ordered list.
    expect(body.speakers).toEqual([
      { name: "Сидоров П.П.", regalia: "д.м.н." },
    ]);
    // …an omitted field is untouched.
    expect(body.school).toBe(validPayload.school);
    expect(body.specialties).toEqual(["cardiology", "therapy"]);
    // …no unpublish: the state stays published (an edit is not a state reversal).
    expect(body.state).toBe("published");
    expect(body.validTransitions).toEqual(["live"]);

    // The 004 public event page reflects the edit.
    const pub = await app.inject({
      method: "GET",
      url: `/v1/public/events/${slug}`,
    });
    expect(pub.statusCode).toBe(200);
    const page = pub.json() as Record<string, unknown>;
    expect(page.title).toBe("Актуальная терапия ХСН — обновлено");
    expect(page.startsAt).toBe("2026-07-17T17:30:00.000Z");
  });

  it("EARS-2: replacing the program PDF supersedes the stored reference — the 004 page serves the current file, the superseded file is no longer served", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    const slug = created.slug as string;
    const oldRef = created.programPdfRef as string;
    expect(await storage.getBytes(oldRef)).toEqual(pdfV1);
    await transition(cookie, id, "published");

    const replace = multipartBody(
      { payload: JSON.stringify({}) },
      {
        field: "programPdf",
        filename: "program-v2.pdf",
        contentType: "application/pdf",
        body: pdfV2,
      },
    );
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, replace.contentType),
      payload: replace.body,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    // The stored reference is superseded (a new key, not the old one).
    const newRef = body.programPdfRef as string;
    expect(typeof newRef).toBe("string");
    expect(newRef).not.toBe(oldRef);
    // The current object holds the replacement bytes.
    expect(await storage.getBytes(newRef)).toEqual(pdfV2);

    // The 004 public page serves the CURRENT file (the new reference), never the
    // superseded one — no unpublish was needed to correct the detail.
    const pub = await app.inject({
      method: "GET",
      url: `/v1/public/events/${slug}`,
    });
    expect(pub.statusCode).toBe(200);
    const page = pub.json() as Record<string, unknown>;
    expect(page.programPdfUrl).toBe(storage.urlFor(newRef));
    expect(page.programPdfUrl).not.toBe(storage.urlFor(oldRef));
  });

  it("EARS-2: a successful supersede garbage-collects the superseded object — the old key no longer exists in storage while the new file is served (#627)", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    const slug = created.slug as string;
    const oldRef = created.programPdfRef as string;
    expect(await storage.exists(oldRef)).toBe(true);
    await transition(cookie, id, "published");

    const replace = multipartBody(
      { payload: JSON.stringify({}) },
      {
        field: "programPdf",
        filename: "program-v2.pdf",
        contentType: "application/pdf",
        body: pdfV2,
      },
    );
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, replace.contentType),
      payload: replace.body,
    });
    expect(res.statusCode).toBe(200);
    const newRef = (res.json() as Record<string, unknown>)
      .programPdfRef as string;

    // GC-on-supersede (#627): the superseded object is deleted from the real
    // bucket once the reference swap commits — orphans do not accumulate.
    expect(await storage.exists(oldRef)).toBe(false);
    expect(await storage.getBytes(oldRef)).toBeNull();
    // The current object is intact and is what the 004 page serves.
    expect(await storage.getBytes(newRef)).toEqual(pdfV2);
    const pub = await app.inject({
      method: "GET",
      url: `/v1/public/events/${slug}`,
    });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as Record<string, unknown>).programPdfUrl).toBe(
      storage.urlFor(newRef),
    );
  });

  it("EARS-2: an edit to an archived event is refused (409) — editing is a pre-archive action", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    for (const to of ["published", "live", "ended", "archived"])
      await transition(cookie, id, to);

    const edit = multipartBody({
      payload: JSON.stringify({ title: "слишком поздно" }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, edit.contentType),
      payload: edit.body,
    });
    expect(res.statusCode).toBe(409);

    // The aggregate is untouched.
    const { rows } = await pool.query<{ title: string; state: string }>(
      "SELECT title, state FROM events WHERE id = $1",
      [id],
    );
    expect(rows[0]?.title).toBe(validPayload.title);
    expect(rows[0]?.state).toBe("archived");
  });

  it("EARS-2: editing an unknown event id is a 404", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const edit = multipartBody({ payload: JSON.stringify({ title: "x" }) });
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/events/00000000-0000-4000-8000-000000000000",
      headers: admHeaders(cookie, edit.contentType),
      payload: edit.body,
    });
    expect(res.statusCode).toBe(404);
  });

  it("EARS-2: a malformed edit payload is rejected (400) with no mutation", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    const bad = multipartBody({
      payload: JSON.stringify({ startsAtMsk: "17.07.2026 20:00" }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, bad.contentType),
      payload: bad.body,
    });
    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query<{ starts_at: Date }>(
      "SELECT starts_at FROM events WHERE id = $1",
      [id],
    );
    // 19:00 МСК == 16:00Z — untouched by the rejected edit.
    expect(rows[0]?.starts_at.toISOString()).toBe("2026-07-17T16:00:00.000Z");
  });

  it("EARS-8: a doctor_guest is refused (403) — not silently satisfied — on the edit command", async () => {
    const adminCookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(adminCookie);
    const id = created.id as string;

    const guestCookie = await session(uniqueEmail("doc"), "doctor_guest");
    const edit = multipartBody({ payload: JSON.stringify({ title: "nope" }) });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(guestCookie, edit.contentType),
      payload: edit.body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("EARS-8: an unauthenticated caller is refused (401) on the edit command", async () => {
    const adminCookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(adminCookie);
    const id = created.id as string;

    const edit = multipartBody({ payload: JSON.stringify({ title: "nope" }) });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: { ...device, "content-type": edit.contentType },
      payload: edit.body,
    });
    expect(res.statusCode).toBe(401);
  });
});

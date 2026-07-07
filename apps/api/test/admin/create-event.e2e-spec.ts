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

// 007 EARS-1 — CreateEvent (POST /v1/admin/events) + EARS-8 authz. A
// platform_admin creates an event in `draft` with the full field set; the МСК
// entry is stored as one canonical instant; speakers persist as an ordered
// free-text list; the program PDF lands in object storage and the reference is
// on the aggregate; a draft event is reachable only through the platform_admin
// admin reads (an unauthenticated / doctor_guest caller is refused, never
// silently satisfied). Runs against the dev-stand Postgres + MinIO + the fake
// IdP for the session; skips when those are absent so the shared CI unit job
// stays green (requirements Verification, row 1).
describe.skipIf(
  !process.env.DATABASE_URL || !process.env.IDP_ISSUER || !process.env.S3_ENDPOINT,
)("007 EARS-1 create event → draft (e2e)", () => {
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

  /** Build a multipart/form-data body from string fields + one file part. */
  function multipartBody(
    fields: Record<string, string>,
    file?: {
      field: string;
      filename: string;
      contentType: string;
      body: Buffer;
    },
  ): { body: Buffer; contentType: string } {
    const boundary = `----ds588${Math.random().toString(16).slice(2)}`;
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

  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");

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

  it("EARS-1: when a platform_admin submits the create-event form, the system creates a draft event with the full field set, the МСК entry as one canonical instant, ordered free-text speakers, and the program PDF in object storage", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const mp = multipartBody(
      { payload: JSON.stringify(validPayload) },
      {
        field: "programPdf",
        filename: "program.pdf",
        contentType: "application/pdf",
        body: pdfBytes,
      },
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: {
        ...device,
        cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        "content-type": mp.contentType,
      },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    createdEventIds.push(body.id as string);

    // Draft entry state + full field set.
    expect(body.state).toBe("draft");
    expect(body.title).toBe(validPayload.title);
    expect(body.school).toBe(validPayload.school);
    expect(body.durationMin).toBe(90);
    expect(body.specialties).toEqual(["cardiology", "therapy"]);
    expect(body.partnerRef).toBe("sponsor:acme-pharma");
    expect(body.validTransitions).toEqual(["published"]);

    // МСК → one canonical instant: 19:00 МСК (UTC+3) == 16:00Z.
    expect(body.startsAt).toBe("2026-07-17T16:00:00.000Z");

    // Speakers persist as an ordered free-text list.
    expect(body.speakers).toEqual([
      { name: "Иванов И.И.", regalia: "д.м.н., профессор" },
      { name: "Петрова А.С.", regalia: "к.м.н." },
    ]);

    // The program PDF landed in object storage and the reference is on the aggregate.
    expect(typeof body.programPdfRef).toBe("string");
    expect((body.programPdfRef as string).length).toBeGreaterThan(0);
    expect(await storage.exists(body.programPdfRef as string)).toBe(true);
    const stored = await storage.getBytes(body.programPdfRef as string);
    expect(stored?.equals(pdfBytes)).toBe(true);

    // Persisted state is draft (single source of truth).
    const { rows } = await pool.query<{ state: string }>(
      "SELECT state FROM events WHERE id = $1",
      [body.id],
    );
    expect(rows[0]?.state).toBe("draft");
  });

  it("EARS-1: a created draft event is returned by the platform_admin admin reads (list + detail)", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const mp = multipartBody(
      { payload: JSON.stringify(validPayload) },
      {
        field: "programPdf",
        filename: "program.pdf",
        contentType: "application/pdf",
        body: pdfBytes,
      },
    );
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: {
        ...device,
        cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        "content-type": mp.contentType,
      },
      payload: mp.body,
    });
    const id = (created.json() as { id: string }).id;
    createdEventIds.push(id);

    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/events",
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: { id: string; state: string }[] };
    expect(listBody.data.some((e) => e.id === id && e.state === "draft")).toBe(
      true,
    );

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/events/${id}`,
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { id: string }).id).toBe(id);
  });

  it("EARS-8: a draft event is not publicly reachable — an unauthenticated caller is refused on the admin create + reads", async () => {
    const mp = multipartBody({ payload: JSON.stringify(validPayload) });
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: { ...device, "content-type": mp.contentType },
      payload: mp.body,
    });
    expect(create.statusCode).toBe(401);

    const list = await app.inject({ method: "GET", url: "/v1/admin/events" });
    expect(list.statusCode).toBe(401);
  });

  it("EARS-8: a doctor_guest is refused (403) — not silently satisfied — on the admin create and reads", async () => {
    const cookie = await session(uniqueEmail("doc"), "doctor_guest");
    const mp = multipartBody(
      { payload: JSON.stringify(validPayload) },
      {
        field: "programPdf",
        filename: "program.pdf",
        contentType: "application/pdf",
        body: pdfBytes,
      },
    );
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: {
        ...device,
        cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        "content-type": mp.contentType,
      },
      payload: mp.body,
    });
    expect(create.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/events",
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    expect(list.statusCode).toBe(403);
  });

  it("EARS-1: an unknown provider / malformed payload is rejected (the МСК field and speakers are validated)", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const bad = multipartBody({
      payload: JSON.stringify({ ...validPayload, startsAtMsk: "17.07.2026 19:00" }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: {
        ...device,
        cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
        "content-type": bad.contentType,
      },
      payload: bad.body,
    });
    expect(res.statusCode).toBe(400);
  });
});

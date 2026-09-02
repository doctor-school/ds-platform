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
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 007 EARS-2 — UpdateEvent (PATCH /v1/admin/events/:id) + replaceable program
// PDF. A platform_admin edits an event's fields at any pre-hide state and the
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

    // 011 EARS-2: an admin route authenticates ONLY through
    // __Host-ds_admin_session, so a platform_admin principal holds an ADMIN
    // session here, not the doctor-portal one it borrowed in wave 1.
    if (role === "platform_admin") {
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
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
      ...authHeaders(cookie),
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

  /**
   * The current `If-Match` validator (#1593) — the transition command is
   * conditional. Staleness itself is owned by
   * `test/admin/optimistic-concurrency.e2e-spec.ts`.
   */
  async function ifMatch(id: string): Promise<Record<string, string>> {
    const { rows } = await pool.query<{ version: number }>(
      "SELECT version FROM events WHERE id = $1",
      [id],
    );
    return { "if-match": `"${rows[0]?.version ?? 1}"` };
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
      headers: {
        ...admHeaders(cookie, "application/json"),
        ...(await ifMatch(id)),
      },
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
      await deleteEventFixture(pool, id);
    for (const email of createdEmails.splice(0))
      await deleteUserFixture(pool, "email", email);
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
    // The edited instant (2026-07-17T17:30Z + 120 min) is deliberately pinned —
    // this case is about the МСК→UTC fold above — so the event's scheduled end
    // is permanently past and its room was never opened. Since 014 EARS-18 that
    // is exactly the published event which offers BOTH edges out: `live` (007
    // EARS-5 OpenRoom) and `ended` (MarkEventEnded, for an эфир held off the
    // platform). The read model offers the pair; the edit still does not
    // unpublish.
    expect(body.validTransitions).toEqual(["live", "ended"]);

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

  /** The event's speaker rows as stored — retired ones included, order stable. */
  async function speakerRows(id: string): Promise<
    {
      id: string;
      name: string;
      position: number;
      record_status: string;
      deleted_at: Date | null;
    }[]
  > {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      position: number;
      record_status: string;
      deleted_at: Date | null;
    }>(
      `SELECT id, name, position, record_status, deleted_at
         FROM event_speakers WHERE event_id = $1
        ORDER BY record_status, position`,
      [id],
    );
    return rows;
  }

  it("EARS-2: dropping a speaker RETIRES the row (never deletes it) and re-adding that speaker RESTORES the same row — #1278 §3.6", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;

    const before = await speakerRows(id);
    expect(before).toHaveLength(2);
    const retiredId = before.find((r) => r.name === "Петрова А.С.")!.id;

    // Drop the second speaker.
    const drop = multipartBody({
      payload: JSON.stringify({ speakers: [validPayload.speakers[0]] }),
    });
    const dropped = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, drop.contentType),
      payload: drop.body,
    });
    expect(dropped.statusCode).toBe(200);
    // The API answers with the ACTIVE list only…
    expect((dropped.json() as Record<string, unknown>).speakers).toEqual([
      validPayload.speakers[0],
    ]);
    // …while the departed speaker's row is still there, retired, with the same id.
    const after = await speakerRows(id);
    expect(after).toHaveLength(2);
    const retired = after.find((r) => r.id === retiredId)!;
    expect(retired.record_status).toBe("retired");
    expect(retired.deleted_at).not.toBeNull();
    expect(retired.name).toBe("Петрова А.С.");

    // Re-adding the same person restores THAT row (§3.6 rule 2), with the new
    // regalia — never a second row for the same speaker.
    const readd = multipartBody({
      payload: JSON.stringify({
        speakers: [
          validPayload.speakers[0],
          { name: "Петрова А.С.", regalia: "д.м.н." },
        ],
      }),
    });
    const restored = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, readd.contentType),
      payload: readd.body,
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as Record<string, unknown>).speakers).toEqual([
      validPayload.speakers[0],
      { name: "Петрова А.С.", regalia: "д.м.н." },
    ]);
    const final = await speakerRows(id);
    expect(final).toHaveLength(2);
    const back = final.find((r) => r.id === retiredId)!;
    expect(back.record_status).toBe("active");
    expect(back.deleted_at).toBeNull();
    expect(back.position).toBe(1);
  });

  it("EARS-2: a lifecycle transition returns the same ACTIVE speaker projection as every other read — a retired speaker is never republished — #1278 §3.6", async () => {
    // `updateStateWithAudit` (publish / open room / hide) answers with the
    // event aggregate too. If it read the raw speaker list, the SAME event would
    // yield two different speaker lists depending on which command produced the
    // response, and a dropped speaker would reappear on the next transition.
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;

    const drop = multipartBody({
      payload: JSON.stringify({ speakers: [validPayload.speakers[0]] }),
    });
    const dropped = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, drop.contentType),
      payload: drop.body,
    });
    expect(dropped.statusCode).toBe(200);
    const rowsAfterDrop = await speakerRows(id);
    expect(rowsAfterDrop).toHaveLength(2);
    expect(
      rowsAfterDrop.filter((r) => r.record_status === "retired"),
    ).toHaveLength(1);

    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/events/${id}/transition`,
      headers: {
        ...admHeaders(cookie, "application/json"),
        ...(await ifMatch(id)),
      },
      payload: { to: "published" },
    });
    expect(published.statusCode).toBe(200);
    expect((published.json() as Record<string, unknown>).speakers).toEqual([
      validPayload.speakers[0],
    ]);
  });

  it("EARS-2: a NEW speaker may take the slot a retired one held, and re-ordering the same people keeps their rows — #1278 §3.6", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    const original = await speakerRows(id);
    const ivanovId = original.find((r) => r.name === "Иванов И.И.")!.id;

    // Иванов leaves slot 0 and a different person takes it: the partial unique
    // index lets the retained (retired) row and the new active one coexist.
    const replace = multipartBody({
      payload: JSON.stringify({
        speakers: [
          { name: "Сидоров П.П.", regalia: "д.м.н." },
          validPayload.speakers[1],
        ],
      }),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, replace.contentType),
      payload: replace.body,
    });
    expect(res.statusCode).toBe(200);
    const rows = await speakerRows(id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.record_status === "active")).toHaveLength(2);
    const retiredIvanov = rows.find((r) => r.id === ivanovId)!;
    expect(retiredIvanov.record_status).toBe("retired");
    expect(retiredIvanov.position).toBe(0);
    expect(
      rows.find(
        (r) => r.name === "Сидоров П.П." && r.record_status === "active",
      )?.position,
    ).toBe(0);

    // A pure re-ordering of the CURRENT list moves positions on the same rows —
    // no row is created, none is retired (the transient unique collision the
    // partial index would raise is sequenced by the reconcile, not by luck).
    const activeIds = new Map(
      rows
        .filter((r) => r.record_status === "active")
        .map((r) => [r.name, r.id] as const),
    );
    const reorder = multipartBody({
      payload: JSON.stringify({
        speakers: [validPayload.speakers[1], { name: "Сидоров П.П." }],
      }),
    });
    const reordered = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, reorder.contentType),
      payload: reorder.body,
    });
    expect(reordered.statusCode).toBe(200);
    const afterReorder = await speakerRows(id);
    expect(afterReorder).toHaveLength(3);
    const active = afterReorder.filter((r) => r.record_status === "active");
    expect(active).toHaveLength(2);
    for (const row of active) expect(row.id).toBe(activeIds.get(row.name));
    expect(active.find((r) => r.name === "Петрова А.С.")?.position).toBe(0);
    expect(active.find((r) => r.name === "Сидоров П.П.")?.position).toBe(1);
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
    // Signed URLs are freshly issued per read (#842) — assert on the object
    // key they address, not byte-equality of a time-varying signature.
    const page = pub.json() as Record<string, unknown>;
    expect(page.programPdfUrl).toContain(newRef);
    expect(page.programPdfUrl).not.toContain(oldRef);
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
    expect((pub.json() as Record<string, unknown>).programPdfUrl).toContain(
      newRef,
    );
  });

  it("EARS-2: an edit to a hidden event is refused (409) — editing is a pre-hide action", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;
    for (const to of ["published", "live", "ended", "hidden"])
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
    expect(rows[0]?.state).toBe("hidden");
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

  it("014 EARS-1: a readiness date that is not on the calendar is refused (400), never forwarded to the date column", async () => {
    const cookie = await session(uniqueEmail("admin"), "platform_admin");
    const created = await createEvent(cookie);
    const id = created.id as string;

    // A real promise lands first, so the refusal below is provably a refusal and
    // not just "nothing was written anyway".
    const good = multipartBody({
      payload: JSON.stringify({ recordingExpectedBy: "2026-09-01" }),
    });
    const accepted = await app.inject({
      method: "PATCH",
      url: `/v1/admin/events/${id}`,
      headers: admHeaders(cookie, good.contentType),
      payload: good.body,
    });
    expect(accepted.statusCode).toBe(200);

    // `2026-13-45` matches the `YYYY-MM-DD` SHAPE but names no day that exists.
    // Unwired, it reaches Postgres as an out-of-range `date` and the API answers
    // with a 5xx it authored itself — banned by 014-design §11 / ADR-0002 §9.
    for (const impossible of ["2026-13-45", "2026-02-31"]) {
      const bad = multipartBody({
        payload: JSON.stringify({ recordingExpectedBy: impossible }),
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${id}`,
        headers: admHeaders(cookie, bad.contentType),
        payload: bad.body,
      });
      expect(res.statusCode).toBe(400);
    }

    // `::text` so the assertion reads the stored CALENDAR DAY, not the driver's
    // local-timezone rendering of a `date`.
    const { rows } = await pool.query<{ expected_by: string | null }>(
      "SELECT recording_expected_by::text AS expected_by FROM events WHERE id = $1",
      [id],
    );
    expect(rows[0]?.expected_by).toBe("2026-09-01");
  });

  it("EARS-8: a doctor_guest is refused (401) — not silently satisfied — on the edit command", async () => {
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
    // 011 EARS-2: refused 401, not 403 — since the admin tier, a doctor-portal cookie authenticates NO admin route, so the request never reaches the role check.
    expect(res.statusCode).toBe(401);
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

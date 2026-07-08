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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-9 — one source of truth for event state across the whole epic. The
// `EventLifecycleState` the 007 admin commands write (create → publish → open →
// close → archive) is EXACTLY what the 004 read models (the public event page +
// the upcoming listing) resolve for the same event in every state — there is no
// second visibility flag, and admin and the portal surfaces can never present a
// contradictory state. This is the cross-cutting assertion the admin-integration
// slice owns (requirements Verification, row 9). Drives the real admin write path
// + the real public read path against dev-stand Postgres; skips when the stand
// env is absent so the shared CI unit job stays green.
describe.skipIf(
  !process.env.DATABASE_URL || !process.env.IDP_ISSUER || !process.env.S3_ENDPOINT,
)("007 EARS-9 single source of truth: admin state == portal read state", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
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

  async function adminSession(): Promise<string> {
    const email = uniqueEmail("admin");
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);
    const { rows } = await pool.query<{ zitadel_sub: string }>(
      "SELECT zitadel_sub FROM users WHERE email = $1",
      [email],
    );
    await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(res.statusCode).toBe(200);
    return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
  }

  function authHeaders(cookie: string) {
    return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
  }

  function multipartBody(fields: Record<string, string>) {
    const boundary = `----ds595${Math.random().toString(16).slice(2)}`;
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

  const payload = {
    title: "Единый источник состояния",
    school: "Кардиология сегодня",
    startsAtMsk: "2026-07-17T19:00",
    durationMin: 90,
    description: "EARS-9 single-source check.",
    speakers: [{ name: "Иванов И.И.", regalia: "д.м.н." }],
    specialties: ["cardiology"],
    partnerRef: "sponsor:acme",
  };

  /** The current admin-detail state for an event (the write-side source of truth). */
  async function adminState(cookie: string, id: string): Promise<string> {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/events/${id}`,
      headers: authHeaders(cookie),
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { state: string }).state;
  }

  /** The public event-page state, or `null` when the page is not publicly reachable. */
  async function publicPageState(idOrSlug: string): Promise<string | null> {
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/events/${idOrSlug}`,
    });
    if (res.statusCode === 404) return null;
    expect(res.statusCode).toBe(200);
    return (res.json() as { state: string }).state;
  }

  /** Whether the event id appears on the 004 upcoming listing (the 005 register-gate input). */
  async function listedUpcoming(id: string): Promise<boolean> {
    const res = await app.inject({ method: "GET", url: "/v1/public/events" });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: string }[]).some((c) => c.id === id);
  }

  async function transition(
    cookie: string,
    id: string,
    command: "publish" | "open" | "close" | "archive",
  ) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/events/${id}/${command}`,
      headers: authHeaders(cookie),
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

  it("EARS-9: the admin state and the 004 public read resolve the SAME EventLifecycleState across every lifecycle state", async () => {
    const cookie = await adminSession();
    const mp = multipartBody({ payload: JSON.stringify(payload) });
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/events",
      headers: { ...authHeaders(cookie), "content-type": mp.contentType },
      payload: mp.body,
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    createdEventIds.push(id);

    // draft — admin says draft; the public page has NO projection (not reachable);
    // the listing does not carry it. One field, no second flag.
    expect(await adminState(cookie, id)).toBe("draft");
    expect(await publicPageState(id)).toBeNull();
    expect(await listedUpcoming(id)).toBe(false);

    // published — admin == public == published; the listing now carries it (005
    // registration opens off exactly this state).
    await transition(cookie, id, "publish");
    expect(await adminState(cookie, id)).toBe("published");
    expect(await publicPageState(id)).toBe("published");
    expect(await listedUpcoming(id)).toBe(true);

    // live — admin == public == live; still listed (the "live now" signal is the
    // same state field, not a second flag).
    await transition(cookie, id, "open");
    expect(await adminState(cookie, id)).toBe("live");
    expect(await publicPageState(id)).toBe("live");
    expect(await listedUpcoming(id)).toBe(true);

    // ended — admin == public == ended; dropped from the upcoming listing off the
    // same state.
    await transition(cookie, id, "close");
    expect(await adminState(cookie, id)).toBe("ended");
    expect(await publicPageState(id)).toBe("ended");
    expect(await listedUpcoming(id)).toBe(false);

    // archived — admin == public == archived (the archived notice is a 200 body,
    // not a 404); still absent from the listing. Admin and portal never disagree.
    await transition(cookie, id, "archive");
    expect(await adminState(cookie, id)).toBe("archived");
    expect(await publicPageState(id)).toBe("archived");
    expect(await listedUpcoming(id)).toBe(false);
  });

  it("EARS-9: the aggregate carries exactly ONE lifecycle field — no legacy boolean visibility scatter to reconcile", async () => {
    // The single-source invariant is structural: the events row has a `state`
    // column and NONE of the legacy boolean visibility flags the epic set out to
    // kill (recon §7d: `published`, `archive`, `visible_in_rg`, …). If any such
    // column reappears, admin/portal drift becomes possible again — fail loudly.
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'events'",
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("state");
    for (const legacyFlag of [
      "published",
      "is_published",
      "archive",
      "archived",
      "is_archived",
      "visible_in_rg",
      "visible",
    ]) {
      expect(columns).not.toContain(legacyFlag);
    }
  });
});

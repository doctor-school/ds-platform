import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  PostChatMessageAckSchema,
  RoomConfigSchema,
  type EventLifecycleState,
} from "@ds/schemas";
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

// 006 EARS-3 — live chat over Centrifugo (gated read + real-time post).
//
// Where the room is open, a gated doctor reads the live chat and posts messages
// that fan out to every participant in real time. A message is posted ONLY through
// the gated `PostChatMessage` command: the backend authorizes the SAME server-side
// gate as EARS-1 (authenticated ∧ registered ∧ live) and then publishes to the
// Centrifugo room channel keyed by event id. The `RoomConfig` grant carries a
// server-issued, gate-scoped, SUBSCRIBE-ONLY connection token — no client can
// publish directly to the room channel; publishing is server-side over the
// Centrifugo HTTP API, credentialed with the API key a browser never holds
// (EARS-3, EARS-8; design §4).
//
// Registration is exercised through the REAL 005 command so the gate reads the
// actual durable roster; event lifecycle is SEEDED + flipped with a scoped UPDATE
// (the 006↔007 tracked seam → parent #576). The fan-out is asserted against the
// REAL dev-stand Centrifugo: each posted message is read back from the channel's
// history over the Centrifugo HTTP API (the durable-ish transient record), and the
// gate-scoping + subscribe-only shape is asserted on the minted token's claims.
// Each event seeds a fresh, unique channel (`room:event:<uuid>`) so history never
// bleeds across tests. Runs against dev-stand Postgres + the fake IdP + Centrifugo;
// skips when CENTRIFUGO_URL / DATABASE_URL / IDP_ISSUER is absent so the shared CI
// unit job stays green (requirements Verification, row 3).
const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL;
const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY;

/** The per-event room channel, keyed by event id (design §4). */
function roomChannel(eventId: string): string {
  return `room:event:${eventId}`;
}

/** Read a channel's publication history over the Centrifugo HTTP API. */
async function centrifugoHistory(
  channel: string,
): Promise<Array<{ data: { id: string; authorTag: string; text: string; at: string } }>> {
  const res = await fetch(`${CENTRIFUGO_URL}/api/history`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": CENTRIFUGO_API_KEY as string,
    },
    body: JSON.stringify({ channel, limit: 100, reverse: false }),
  });
  const body = (await res.json()) as {
    result?: {
      publications?: Array<{
        data: { id: string; authorTag: string; text: string; at: string };
      }>;
    };
  };
  return body.result?.publications ?? [];
}

/** Attempt a direct Centrifugo publish; `apiKey` omitted = a client with no key. */
async function centrifugoPublish(
  channel: string,
  data: unknown,
  apiKey?: string,
): Promise<{ status: number; error?: { code: number } }> {
  const res = await fetch(`${CENTRIFUGO_URL}/api/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    body: JSON.stringify({ channel, data }),
  });
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { error?: { code: number } };
  return { status: res.status, error: body.error };
}

/** Decode a JWT payload segment (no verification — asserting the claims shape). */
function decodeJwtPayload(token: string): {
  sub?: string;
  channels?: string[];
  exp?: number;
} {
  const segment = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe.skipIf(
  !process.env.CENTRIFUGO_URL ||
    !process.env.DATABASE_URL ||
    !process.env.IDP_ISSUER,
)("006 EARS-3 live chat over Centrifugo (e2e)", () => {
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

  /** Seed one event directly in `state` — the 006↔007 fixture seam. */
  async function seedEvent(
    state: EventLifecycleState,
  ): Promise<{ id: string; slug: string }> {
    const id = randomUUID();
    const slug = `room3-${id.slice(0, 8)}`;
    await pool.query(
      `INSERT INTO events
         (id, slug, title, school, starts_at, duration_min, description,
          specialties, partner_ref, program_pdf_ref, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        slug,
        "Актуальная терапия ХСН",
        "Кардиология сегодня",
        "2026-07-17T16:00:00.000Z",
        90,
        "Разбор клинических рекомендаций.",
        ["cardiology"],
        "sponsor:acme-pharma",
        null,
        state,
      ],
    );
    createdEventIds.push(id);
    return { id, slug };
  }

  /** Simulate a 007 director transition on a seeded event (scoped UPDATE). */
  async function setState(
    id: string,
    state: EventLifecycleState,
  ): Promise<void> {
    await pool.query("UPDATE events SET state = $2 WHERE id = $1", [id, state]);
  }

  /** Register + login a doctor_guest; return the session cookie value. */
  async function doctorSession(email: string): Promise<string> {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);
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

  function cookieHeader(cookie: string): Record<string, string> {
    return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
  }

  /** Register the authenticated doctor for the event via the real 005 command. */
  async function register(slug: string, cookie: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: `/v1/events/${slug}/registration`,
      headers: cookieHeader(cookie),
    });
    expect(res.statusCode).toBe(200);
  }

  function getRoom(
    slug: string,
    headers: Record<string, string>,
  ): ReturnType<NestFastifyApplication["inject"]> {
    return app.inject({ method: "GET", url: `/v1/events/${slug}/room`, headers });
  }

  function postChat(
    slug: string,
    headers: Record<string, string>,
    payload: unknown,
  ): ReturnType<NestFastifyApplication["inject"]> {
    return app.inject({
      method: "POST",
      url: `/v1/events/${slug}/chat`,
      headers,
      payload,
    });
  }

  /** Seed a published event, register the doctor, open the room (→ live). */
  async function liveRoom(prefix: string): Promise<{
    id: string;
    slug: string;
    cookie: string;
  }> {
    const { id, slug } = await seedEvent("published");
    const cookie = await doctorSession(uniqueEmail(prefix));
    await register(slug, cookie);
    await setState(id, "live");
    return { id, slug, cookie };
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
    for (const id of createdEventIds.splice(0)) {
      await pool.query("DELETE FROM presence_beats WHERE event_id = $1", [id]);
      await pool.query("DELETE FROM events WHERE id = $1", [id]);
    }
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-3: when a gated doctor reads room content, the system shall issue a subscribe-only chat token scoped to exactly that room channel (no publish capability, no other room)", async () => {
    const { id, slug, cookie } = await liveRoom("doc-chat-token");
    const res = await getRoom(slug, cookieHeader(cookie));
    expect(res.statusCode).toBe(200);
    const config = RoomConfigSchema.parse(res.json());

    // The grant carries a chat credential (Centrifugo is configured on the stand).
    expect(config.chat).not.toBeNull();
    const chat = config.chat!;
    // The channel is the per-event room channel, keyed by event id.
    expect(chat.channel).toBe(roomChannel(id));
    // The websocket endpoint is a ws(s) URL the browser connects to.
    expect(chat.url).toMatch(/^wss?:\/\//);
    expect(chat.selfTag.length).toBeGreaterThan(0);

    // The token is gate-scoped + subscribe-only: its `channels` claim lists EXACTLY
    // this one room channel (Centrifugo subscribes the connection server-side), it
    // has a subject + an expiry, and it grants NO publish capability — a doctor
    // gated for this room cannot use it to read another room or to publish.
    const claims = decodeJwtPayload(chat.token);
    expect(claims.channels).toEqual([roomChannel(id)]);
    expect(typeof claims.sub).toBe("string");
    expect(typeof claims.exp).toBe("number");
    expect(claims.exp! * 1000).toBeGreaterThan(Date.now());
  });

  it("EARS-3: when a gated doctor posts a message through the gated command, the system shall publish it to the room channel and fan it out over Centrifugo", async () => {
    const { id, slug, cookie } = await liveRoom("doc-chat-post");
    const channel = roomChannel(id);
    expect(await centrifugoHistory(channel)).toHaveLength(0);

    const text = "Коллеги, отличный разбор рекомендаций!";
    const res = await postChat(slug, cookieHeader(cookie), { text });
    expect(res.statusCode).toBe(200);
    const ack = PostChatMessageAckSchema.parse(res.json());
    expect(ack.eventId).toBe(id);
    expect(ack.message.text).toBe(text);
    expect(ack.message.authorTag.length).toBeGreaterThan(0);

    // The message fanned out to the REAL Centrifugo room channel (read back from
    // history) — server-authoritative id/instant, the acked message verbatim.
    const history = await centrifugoHistory(channel);
    expect(history).toHaveLength(1);
    expect(history[0].data.id).toBe(ack.message.id);
    expect(history[0].data.text).toBe(text);
    expect(history[0].data.authorTag).toBe(ack.message.authorTag);
  });

  it("EARS-3: the posted text is trimmed to the schema SSOT (no leading/trailing padding survives)", async () => {
    const { id, slug, cookie } = await liveRoom("doc-chat-trim");
    const res = await postChat(slug, cookieHeader(cookie), {
      text: "  собственно вопрос  ",
    });
    expect(res.statusCode).toBe(200);
    const ack = PostChatMessageAckSchema.parse(res.json());
    expect(ack.message.text).toBe("собственно вопрос");
    const history = await centrifugoHistory(roomChannel(id));
    expect(history[0].data.text).toBe("собственно вопрос");
  });

  it("EARS-3: an empty / whitespace-only message is rejected (400) and nothing is published", async () => {
    const { id, slug, cookie } = await liveRoom("doc-chat-empty");
    for (const bad of [{ text: "" }, { text: "   " }, {}]) {
      const res = await postChat(slug, cookieHeader(cookie), bad);
      expect(res.statusCode).toBe(400);
    }
    expect(await centrifugoHistory(roomChannel(id))).toHaveLength(0);
  });

  it("EARS-3/8: when a guest (no session) posts a message, the system shall refuse it server-side (401) and publish nothing", async () => {
    const { id, slug } = await seedEvent("published");
    await setState(id, "live");
    const res = await postChat(slug, device, { text: "проникновение" });
    expect(res.statusCode).toBe(401);
    expect(await centrifugoHistory(roomChannel(id))).toHaveLength(0);
  });

  it("EARS-3/8: when an authenticated but unregistered doctor posts a message, the system shall refuse it server-side (403) and publish nothing", async () => {
    const { id, slug } = await seedEvent("published");
    await setState(id, "live");
    const cookie = await doctorSession(uniqueEmail("doc-chat-unreg"));
    const res = await postChat(slug, cookieHeader(cookie), { text: "пусти" });
    expect(res.statusCode).toBe(403);
    expect(await centrifugoHistory(roomChannel(id))).toHaveLength(0);
  });

  it("EARS-3/8: when a registered doctor posts to a non-live (published) room, the system shall refuse it server-side (409) and publish nothing", async () => {
    const { id, slug } = await seedEvent("published");
    const cookie = await doctorSession(uniqueEmail("doc-chat-notlive"));
    await register(slug, cookie);
    const res = await postChat(slug, cookieHeader(cookie), { text: "рано" });
    expect(res.statusCode).toBe(409);
    expect(await centrifugoHistory(roomChannel(id))).toHaveLength(0);
  });

  it("EARS-3/8: when a registered doctor posts to an ended room, the system shall refuse it server-side (409) and publish nothing — chat stops at room close", async () => {
    const { id, slug, cookie } = await liveRoom("doc-chat-ended");
    await setState(id, "ended");
    const res = await postChat(slug, cookieHeader(cookie), { text: "поздно" });
    expect(res.statusCode).toBe(409);
    expect(await centrifugoHistory(roomChannel(id))).toHaveLength(0);
  });

  it("EARS-3/8: a client WITHOUT the server-issued API key cannot publish directly to the room channel — only the credentialed server-side command can", async () => {
    const { id } = await liveRoom("doc-chat-direct");
    const channel = roomChannel(id);
    const forged = {
      id: randomUUID(),
      authorTag: "FAKE",
      text: "прямой вброс мимо гейта",
      at: new Date().toISOString(),
    };

    // A browser client holds only the subscribe-only connection token — never the
    // http_api key. A direct publish with no key (or a wrong key) is refused by
    // Centrifugo (401), so a client can never publish to the room channel: every
    // post MUST ride the gated command.
    const noKey = await centrifugoPublish(channel, forged);
    expect(noKey.status).toBe(401);
    const wrongKey = await centrifugoPublish(channel, forged, "not-the-key");
    expect(wrongKey.status).toBe(401);
    // Nothing landed on the channel from either forged attempt.
    expect(await centrifugoHistory(channel)).toHaveLength(0);

    // The SAME publish WITH the server's real key succeeds — proving the channel is
    // publishable ONLY by the credentialed server side (the gated command's path).
    const withKey = await centrifugoPublish(channel, forged, CENTRIFUGO_API_KEY);
    expect(withKey.status).toBe(200);
    expect(withKey.error).toBeUndefined();
  });

  it("EARS-3/8: when an unknown event's room chat is posted to, the system shall refuse it server-side (404)", async () => {
    const cookie = await doctorSession(uniqueEmail("doc-chat-missing"));
    const res = await postChat("no-such-room-slug", cookieHeader(cookie), {
      text: "куда",
    });
    expect(res.statusCode).toBe(404);
  });
});

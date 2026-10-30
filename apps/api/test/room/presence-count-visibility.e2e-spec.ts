import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  PresenceHeartbeatAckSchema,
  RoomConfigSchema,
  type RoomConfig,
} from "@ds/schemas";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  CentrifugoChatGateway,
  type RoomChatConfig,
} from "../../src/room/chat.gateway.js";
import { PresencePublisher } from "../../src/room/presence-publisher.service.js";
import { PresenceDerivationService } from "../../src/room/presence-derivation.service.js";
import { ROOM_CHAT_CONFIG } from "../../src/room/room.tokens.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 006 EARS-19 (#2911) — the live presence count is hidden from viewers by
// default; the event's «Показывать зрителям число участников» setting shows it,
// and a caller whose session claims carry a staff role sees it whatever the
// setting. The count is withheld AT THE SOURCE on all three room paths:
//
// 1. the `RoomConfig` read and 2. every heartbeat ack carry `presenceCount: null`
//    for a viewer while the setting is off;
// 3. the realtime `presence-count` push rides the shared `room:event:<id>`
//    channel only while the setting is on, and otherwise the staff-only
//    `room:staff:<id>` channel, which only a staff caller's connection token
//    lists — so a viewer's connection never receives it.
//
// Centrifugo is replaced by a configured-but-fake transport: the chat config is
// present (so credentials are minted and the publisher is live) and the
// gateway's publish is spied, so the test reads which CHANNEL each count was
// fanned out to, and decodes each caller's token to read which channels its
// connection is subscribed to server-side. Runs against the dev-stand Postgres +
// the fake IdP; skips when DATABASE_URL or IDP_ISSUER is absent.
const FAKE_CHAT_CONFIG: RoomChatConfig = {
  wsUrl: "ws://centrifugo.test/connection/websocket",
  apiBase: "http://centrifugo.test",
  apiKey: "test-only-api-key",
  hmacSecret: "test-only-hmac-secret",
  tokenTtlSeconds: 600,
};

/** The `channels` claim of a Centrifugo connection token (HS256 JWT payload). */
function tokenChannels(config: RoomConfig): string[] {
  const token = config.chat?.token;
  expect(token).toBeDefined();
  const payload = JSON.parse(
    Buffer.from(token!.split(".")[1]!, "base64url").toString("utf8"),
  ) as { channels: string[] };
  return payload.channels;
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "006 EARS-19 presence-count visibility (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let publishSpy: ReturnType<
      typeof vi.spyOn<CentrifugoChatGateway, "publishPresenceCount">
    >;
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

    /** Seed one `live` event with the given setting — the 006↔007 fixture seam. */
    async function seedLiveEvent(
      showPresenceCount: boolean,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `room19-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            show_presence_count, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live',$11, ${eventClassificationSql()})`,
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
          showPresenceCount,
        ],
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    async function subOf(email: string): Promise<string> {
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      return rows[0]!.zitadel_sub;
    }

    /**
     * A portal session. `staff` grants `platform_admin` BEFORE login, so the
     * session's project-roles claim carries a staff role (the account stays a
     * registered doctor too — staff enter the room through the same gate).
     */
    async function portalSession(
      email: string,
      staff = false,
    ): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      if (staff)
        await fake.grantProjectRole(await subOf(email), "platform_admin");
      return signIn(app, email, password, { device });
    }

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    async function register(slug: string, cookie: string): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/registration`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
    }

    async function roomConfig(
      slug: string,
      cookie: string,
    ): Promise<RoomConfig> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/events/${slug}/room`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
      return RoomConfigSchema.parse(res.json());
    }

    async function heartbeat(
      slug: string,
      cookie: string,
    ): Promise<number | null> {
      const res = await app.inject({
        method: "POST",
        url: `/v1/events/${slug}/heartbeat`,
        headers: cookieHeader(cookie),
      });
      expect(res.statusCode).toBe(200);
      return PresenceHeartbeatAckSchema.parse(res.json()).presenceCount;
    }

    /** A registered doctor (viewer) session for `slug`. */
    async function viewer(slug: string, prefix: string): Promise<string> {
      const cookie = await portalSession(uniqueEmail(prefix));
      await register(slug, cookie);
      return cookie;
    }

    /** A registered staff session for `slug`. */
    async function staffMember(slug: string, prefix: string): Promise<string> {
      const cookie = await portalSession(uniqueEmail(prefix), true);
      await register(slug, cookie);
      return cookie;
    }

    /** Flip the setting through the operator's real path: the admin `UpdateEvent`. */
    async function operatorSets(
      eventId: string,
      showPresenceCount: boolean,
    ): Promise<void> {
      const email = uniqueEmail("operator");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      await fake.grantProjectRole(await subOf(email), "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      const boundary = `----ds2911${Math.random().toString(16).slice(2)}`;
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(
          { showPresenceCount },
        )}\r\n--${boundary}--\r\n`,
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${eventId}`,
        headers: {
          ...device,
          ...authHeaders(admin.sid),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { showPresenceCount: boolean }).showPresenceCount,
      ).toBe(showPresenceCount);
    }

    /** Every `[count, channel]` the publisher fanned out for `eventId`, in order. */
    function publications(eventId: string): Array<[number, string]> {
      const gateway = app.get(CentrifugoChatGateway);
      return publishSpy.mock.calls
        .filter(([id]) => id === eventId)
        .map(([, count, audience]) => [
          count,
          audience === "everyone"
            ? gateway.channelForEvent(eventId)
            : gateway.staffChannelForEvent(eventId),
        ]);
    }

    /** Let the fire-and-forget publisher settle after a beat / an edit. */
    async function publisherSettled(
      eventId: string,
      expected: number,
    ): Promise<void> {
      await vi.waitFor(() => {
        expect(publications(eventId).length).toBeGreaterThanOrEqual(expected);
      });
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .overrideProvider(ROOM_CHAT_CONFIG)
          .useValue(FAKE_CHAT_CONFIG),
      ).compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    beforeEach(() => {
      publishSpy = vi
        .spyOn(app.get(CentrifugoChatGateway), "publishPresenceCount")
        .mockResolvedValue();
    });

    afterEach(async () => {
      publishSpy.mockRestore();
      app.get(PresencePublisher).onModuleDestroy();
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM presence_beats WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("006 EARS-19: setting off — a doctor's RoomConfig and every heartbeat ack carry `presenceCount: null`, never 0", async () => {
      const { slug } = await seedLiveEvent(false);
      const other = await viewer(slug, "vis19-other");
      const doctor = await viewer(slug, "vis19-doctor");
      expect(await heartbeat(slug, other)).toBeNull();

      const config = await roomConfig(slug, doctor);
      expect(config.presenceCount).toBeNull();
      expect(await heartbeat(slug, doctor)).toBeNull();
      expect(await heartbeat(slug, doctor)).toBeNull();
    });

    it("006 EARS-19: setting off — a doctor's connection is subscribed to the shared room channel only, and every count is published to the staff-only channel", async () => {
      const { id, slug } = await seedLiveEvent(false);
      const gateway = app.get(CentrifugoChatGateway);
      const doctor = await viewer(slug, "vis19-rt-doctor");

      const config = await roomConfig(slug, doctor);
      expect(config.chat?.staffChannel).toBeNull();
      expect(tokenChannels(config)).toEqual([gateway.channelForEvent(id)]);

      await heartbeat(slug, doctor);
      await publisherSettled(id, 1);
      expect(publications(id)).toEqual([[1, gateway.staffChannelForEvent(id)]]);
      // No count ever reached the channel a doctor's connection holds.
      expect(
        publications(id).some(([, ch]) => ch === gateway.channelForEvent(id)),
      ).toBe(false);
    });

    it("006 EARS-19: a staff session receives the count on all three paths while the setting is off — and is not itself counted", async () => {
      const { id, slug } = await seedLiveEvent(false);
      const gateway = app.get(CentrifugoChatGateway);
      const doctor = await viewer(slug, "vis19-staff-doctor");
      const staff = await staffMember(slug, "vis19-staff");

      await heartbeat(slug, doctor);
      const config = await roomConfig(slug, staff);
      // Path 1 — the grant: the participants' count (the staff account itself is
      // not in the population, 2026-09-30 amendment).
      expect(config.presenceCount).toBe(1);
      // Path 2 — the ack.
      expect(await heartbeat(slug, staff)).toBe(1);
      // Path 3 — the staff connection is ALSO subscribed to the staff-only
      // channel, which is where the count was fanned out.
      expect(config.chat?.staffChannel).toBe(gateway.staffChannelForEvent(id));
      expect(tokenChannels(config)).toEqual([
        gateway.channelForEvent(id),
        gateway.staffChannelForEvent(id),
      ]);
      await publisherSettled(id, 1);
      expect(publications(id)).toEqual([[1, gateway.staffChannelForEvent(id)]]);
    });

    it("006 EARS-19: setting on — a doctor receives the count exactly as EARS-5, on the shared room channel", async () => {
      const { id, slug } = await seedLiveEvent(true);
      const gateway = app.get(CentrifugoChatGateway);
      const a = await viewer(slug, "vis19-on-a");
      const b = await viewer(slug, "vis19-on-b");

      expect(await heartbeat(slug, a)).toBe(1);
      const config = await roomConfig(slug, b);
      expect(config.presenceCount).toBe(1);
      expect(config.chat?.staffChannel).toBeNull();
      expect(await heartbeat(slug, b)).toBe(2);
      await publisherSettled(id, 2);
      expect(publications(id)).toEqual([
        [1, gateway.channelForEvent(id)],
        [2, gateway.channelForEvent(id)],
      ]);
    });

    it("006 EARS-19: turning the setting ON while live reaches an open doctor room at once — the unchanged count is pushed on the shared channel without waiting for a beat or a count change", async () => {
      const { id, slug } = await seedLiveEvent(false);
      const gateway = app.get(CentrifugoChatGateway);
      const doctor = await viewer(slug, "vis19-offon");
      expect((await roomConfig(slug, doctor)).presenceCount).toBeNull();
      expect(await heartbeat(slug, doctor)).toBeNull();
      await publisherSettled(id, 1);

      await operatorSets(id, true);

      // No further beat: the edit itself re-published the count to everyone.
      await publisherSettled(id, 2);
      expect(publications(id)).toEqual([
        [1, gateway.staffChannelForEvent(id)],
        [1, gateway.channelForEvent(id)],
      ]);
      // And the doctor's next ack carries it as the guarantee.
      expect(await heartbeat(slug, doctor)).toBe(1);
    });

    it("006 EARS-19: turning the setting OFF while live removes the count from an open doctor room by the next accepted beat, and stops pushing it to viewers", async () => {
      const { id, slug } = await seedLiveEvent(true);
      const gateway = app.get(CentrifugoChatGateway);
      const doctor = await viewer(slug, "vis19-onoff");
      expect(await heartbeat(slug, doctor)).toBe(1);
      await publisherSettled(id, 1);

      await operatorSets(id, false);

      expect(await heartbeat(slug, doctor)).toBeNull();
      await publisherSettled(id, 2);
      const after = publications(id).slice(1);
      expect(after.length).toBeGreaterThan(0);
      expect(
        after.every(([, ch]) => ch === gateway.staffChannelForEvent(id)),
      ).toBe(true);
    });

    it("006 EARS-19: the setting changes neither capture nor the per-doctor minutes — beats are appended and derived identically in both settings", async () => {
      const hidden = await seedLiveEvent(false);
      const shown = await seedLiveEvent(true);
      const a = await viewer(hidden.slug, "vis19-min-a");
      const b = await viewer(shown.slug, "vis19-min-b");
      await heartbeat(hidden.slug, a);
      await heartbeat(shown.slug, b);

      const beats = async (eventId: string): Promise<number> =>
        Number(
          (
            await pool.query<{ n: string }>(
              "SELECT count(*)::text AS n FROM presence_beats WHERE event_id = $1",
              [eventId],
            )
          ).rows[0]!.n,
        );
      expect(await beats(hidden.id)).toBe(1);
      expect(await beats(shown.id)).toBe(1);

      const derivation = app.get(PresenceDerivationService);
      const minutes = async (eventId: string): Promise<number[]> =>
        (await derivation.deriveForEvent(eventId)).doctors.map(
          (row) => row.minutes,
        );
      expect(await minutes(hidden.id)).toEqual(await minutes(shown.id));
    });
  },
);

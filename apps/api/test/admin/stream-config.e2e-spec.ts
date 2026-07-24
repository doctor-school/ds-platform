import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  type EventLifecycleState,
  type StreamConfig,
  STREAM_PROVIDERS,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-3 — ConfigureStream (PUT /v1/admin/events/:id/stream). The stream
// config is recorded from an EXPLICIT provider in the closed enum
// `rutube | youtube` plus an embed reference (the provider-scoped stream id,
// never a URL to be sniffed). An unknown provider is rejected at config time
// (400) with no config recorded; the config is correctable while `published`
// (an idempotent upsert, no state reversal); the persisted config is exactly
// what the 006 room read consumes and the provider is never derived from the
// URL. `platform_admin`-only (EARS-8): a doctor_guest / public caller never
// reaches the command. Runs against dev-stand Postgres + the fake IdP session;
// skips when absent so the shared CI unit job stays green (requirements
// Verification, row 3).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-3 stream config (e2e)",
  () => {
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

    /** Build a multipart/form-data body from string fields. */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds590${Math.random().toString(16).slice(2)}`;
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

    const validPayload = {
      title: "ХСН: stream config",
      school: "Кардиология",
      startsAtMsk: "2026-07-17T19:00",
      durationMin: 90,
      specialties: ["cardiology"],
    };

    /**
     * Realistic provider-scoped embed refs per the `@ds/schemas`
     * `EMBED_REF_SHAPES` SSOT (#665, #1134): YouTube = the 11-char video id,
     * Rutube = the 32-char lowercase-hex video id, VK = the `oid_id_hash` triple,
     * CDNVideo = the host-allowlisted Aloha-player URL. The accept-loop below
     * inserts each into the real `stream_config` row, exercising the additive DB
     * `stream_provider` enum values end-to-end.
     */
    const VALID_EMBED_REFS: Record<(typeof STREAM_PROVIDERS)[number], string> = {
      rutube: "caafe83ff1c6ed38d394635b83ece578",
      youtube: "dQw4w9WgXcQ",
      vk: "-9944999_456239622_5ee41bc00ebc765a",
      cdnvideo:
        "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190",
    };

    /** Create a fresh draft event through the EARS-1 create endpoint; return its id + slug. */
    async function createDraft(
      cookie: string,
    ): Promise<{ id: string; slug: string }> {
      const mp = multipartBody({ payload: JSON.stringify(validPayload) });
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
      const body = res.json() as { id: string; slug: string };
      createdEventIds.push(body.id);
      return { id: body.id, slug: body.slug };
    }

    /** PUT the ConfigureStream command. */
    async function configureStream(
      cookie: string | undefined,
      id: string,
      payload: unknown,
    ) {
      return app.inject({
        method: "PUT",
        url: `/v1/admin/events/${id}/stream`,
        headers: {
          ...device,
          "content-type": "application/json",
          ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}),
        },
        payload: payload as Record<string, unknown>,
      });
    }

    /** Read the persisted stream_config row directly — the exact shape 006 consumes. */
    async function persistedConfig(
      id: string,
    ): Promise<{ provider: string; embed_ref: string } | undefined> {
      const { rows } = await pool.query<{ provider: string; embed_ref: string }>(
        "SELECT provider, embed_ref FROM stream_config WHERE event_id = $1",
        [id],
      );
      return rows[0];
    }

    /** Force a persisted lifecycle state (arrange a non-configurable fixture directly). */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [state, id]);
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

    it("EARS-3: records a config for each provider in the closed enum, and the persisted row is exactly what the 006 room consumes", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");

      for (const provider of STREAM_PROVIDERS) {
        const { id } = await createDraft(cookie);
        const embedRef = VALID_EMBED_REFS[provider];

        const res = await configureStream(cookie, id, { provider, embedRef });
        expect(res.statusCode).toBe(200);

        // The detail read surfaces the config the 006 room reads.
        const body = res.json() as { streamConfig: StreamConfig | null };
        expect(body.streamConfig).toEqual({ provider, embedRef });

        // The provider is stored as the explicit enum member — never derived
        // from a URL string. The persisted row is byte-for-byte the 006 read.
        expect(await persistedConfig(id)).toEqual({
          provider,
          embed_ref: embedRef,
        });
      }
    });

    it("EARS-3: an unknown provider is rejected at config time (400) with no config recorded", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      const res = await configureStream(cookie, id, {
        provider: "vimeo",
        embedRef: "should-not-persist",
      });
      expect(res.statusCode).toBe(400);
      // No config recorded for the unknown provider (fail before the handler).
      expect(await persistedConfig(id)).toBeUndefined();
    });

    it("EARS-3: a garbage embed id matching no provider shape is rejected (400) with no config recorded (Stage-B «ччсапп», #665)", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      // The owner's Stage-B repro: a keyboard-mash token previously persisted
      // with a success banner. The per-provider `EMBED_REF_SHAPES` SSOT now
      // refuses it at the DTO boundary for every provider in the enum.
      for (const provider of STREAM_PROVIDERS) {
        const res = await configureStream(cookie, id, {
          provider,
          embedRef: "ччсапп",
        });
        expect(res.statusCode, `garbage id must 400 for ${provider}`).toBe(400);
      }
      expect(await persistedConfig(id)).toBeUndefined();
    });

    it("EARS-3: the config is correctable while published, replacing the reference with no state reversal", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      // Author an initial (wrong-for-the-event but well-formed) config while draft.
      expect(
        (
          await configureStream(cookie, id, {
            provider: "rutube",
            embedRef: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
          })
        ).statusCode,
      ).toBe(200);

      // Publish (draft → published) so the correction happens on a live event.
      const pub = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/publish`,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      expect(pub.statusCode).toBe(200);

      // Correct the embed reference while `published` — a plain upsert, not an
      // unpublish. The provider may switch too (still explicit, still enum).
      const fix = await configureStream(cookie, id, {
        provider: "youtube",
        embedRef: "c0rrectedYt",
      });
      expect(fix.statusCode).toBe(200);
      const body = fix.json() as {
        state: EventLifecycleState;
        streamConfig: StreamConfig | null;
      };
      // No state reversal — the event stays `published` (US-3).
      expect(body.state).toBe("published");
      expect(body.streamConfig).toEqual({
        provider: "youtube",
        embedRef: "c0rrectedYt",
      });
      // Exactly one row per event — the correction replaced, not appended.
      expect(await persistedConfig(id)).toEqual({
        provider: "youtube",
        embed_ref: "c0rrectedYt",
      });
    });

    it("EARS-3: configuring is refused (409) once the event is past the pre-air window", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      for (const state of ["live", "ended", "archived"] as const) {
        await forceState(id, state);
        const res = await configureStream(cookie, id, {
          provider: "rutube",
          embedRef: VALID_EMBED_REFS.rutube,
        });
        expect(res.statusCode, `configure must be refused from ${state}`).toBe(
          409,
        );
        expect(await persistedConfig(id)).toBeUndefined();
      }
    });

    it("EARS-3: configuring a non-existent event is a 404", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const res = await configureStream(
        cookie,
        "00000000-0000-0000-0000-000000000000",
        { provider: "rutube", embedRef: VALID_EMBED_REFS.rutube },
      );
      expect(res.statusCode).toBe(404);
    });

    it("EARS-8: a doctor_guest is refused (403) — the command is never reached, no config recorded", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(admin);
      const doc = await session(uniqueEmail("doc"), "doctor_guest");
      const res = await configureStream(doc, id, {
        provider: "rutube",
        embedRef: VALID_EMBED_REFS.rutube,
      });
      expect(res.statusCode).toBe(403);
      expect(await persistedConfig(id)).toBeUndefined();
    });

    it("EARS-8: an unauthenticated caller is refused (401) on the stream-config command", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(admin);
      const res = await configureStream(undefined, id, {
        provider: "rutube",
        embedRef: VALID_EMBED_REFS.rutube,
      });
      expect(res.statusCode).toBe(401);
      expect(await persistedConfig(id)).toBeUndefined();
    });
  },
);

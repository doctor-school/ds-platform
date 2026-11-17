import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  FEED_SOURCE_ADDRESS_ERROR,
  FEED_SOURCE_ADDRESS_TAKEN_ERROR,
  PublicFeedPageSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import { TELEGRAM_BOT_API } from "../../src/materials/telegram/telegram-bot-api.types.js";
import { TELEGRAM_CONFIG } from "../../src/materials/telegram/telegram-config.js";
import { SOURCE_CHECK_REASONS } from "../../src/materials/telegram/telegram-source-check.service.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { ADMIN_PENDING_COOKIE_NAME } from "../../src/auth/admin-session/admin-session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import {
  deliverByPoll,
  dropCursor,
  markPolled,
} from "./telegram-ingress.js";

// 048 V-14 (#3993) — the «Источники» admin API over the REAL stack (Fastify +
// the 011 admin session + Postgres): add with the address normalized and the
// duplicate refused, address edit with the `href` rewrite, switch off and on
// with the entry marks in one transaction (EARS-20…EARS-22), and the EARS-23
// floor — `platform_admin` in the MFA admin session, idempotency key,
// `If-Match`, the 010 audit of every write. Add, address edit and switch-on
// run the source check (EARS-31) at once against the Telegram double
// (EARS-21): a channel the double does not know reads «Ошибка» with «Канал не
// найден или бот не добавлен в канал»; a known one reads «Работает», bound.
// Mirrors the materials admin suite. Skips when the stand is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "048 feed sources admin API (e2e)",
  () => {
    let app: NestFastifyApplication;
    /** The Telegram double: no channel known. */
    const telegram = new FakeTelegramBotApi();
    const resetTelegram = () => {
      telegram.reset();
    };
    resetTelegram();
    const NOT_FOUND = SOURCE_CHECK_REASONS.channelNotFound;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const sourceIds: string[] = [];
    const usedKeys: string[] = [];
    const materialIds: string[] = [];
    let adminSid: string;
    let adminSub: string;

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

    /** A fresh valid username: a letter, then 11 lowercase letters/digits. */
    const username = () =>
      `t${Math.random().toString(36).slice(2, 8)}${Math.random()
        .toString(36)
        .slice(2, 7)}`.padEnd(12, "x");

    async function adminSession(): Promise<{
      sid: string;
      sub: string;
      email: string;
    }> {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("src-admin"),
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      const { sid } = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return { sid, sub, email };
    }

    interface Call {
      payload?: Record<string, unknown>;
      sid?: string;
      ifMatch?: string | null;
      idempotencyKey?: string | null;
    }

    function call(method: "POST" | "PATCH" | "GET", url: string, c: Call = {}) {
      const idem = c.idempotencyKey === undefined ? key() : c.idempotencyKey;
      return app.inject({
        method,
        url,
        headers: {
          ...device,
          ...adminHeaders(c.sid ?? adminSid),
          ...(c.payload ? { "content-type": "application/json" } : {}),
          ...(method !== "GET" && idem !== null
            ? { "idempotency-key": idem }
            : {}),
          ...(c.ifMatch ? { "if-match": c.ifMatch } : {}),
        },
        ...(c.payload ? { payload: c.payload } : {}),
      });
    }

    type Source = {
      id: string;
      platform: string;
      address: string;
      enabled: boolean;
      status: string;
      statusReason: string | null;
      checkedAt: string | null;
      entryCount: number;
      version: number;
    };
    const json = (res: { payload: string }) => JSON.parse(res.payload);
    const problem = (res: { payload: string }) =>
      json(res) as {
        errorCode: string;
        errors?: { path: string; message: string }[];
      };

    async function add(address: string, c: Call = {}): Promise<Source> {
      const res = await call("POST", "/v1/admin/feed-sources", {
        payload: { platform: "telegram", address },
        ...c,
      });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as Source;
      sourceIds.push(body.id);
      return body;
    }

    const write = (
      s: { id: string; version: number },
      action: "disable" | "enable",
      c: Call = {},
    ) =>
      call("POST", `/v1/admin/feed-sources/${s.id}/${action}`, {
        ifMatch: `W/"${s.version}"`,
        ...c,
      });
    const edit = (
      s: { id: string; version: number },
      address: string,
      c: Call = {},
    ) =>
      call("PATCH", `/v1/admin/feed-sources/${s.id}`, {
        payload: { address },
        ifMatch: `W/"${s.version}"`,
        ...c,
      });

    async function sourceRow(id: string) {
      const { rows } = await pool.query<{
        address: string;
        enabled: boolean;
        status: string;
        version: number;
      }>("SELECT * FROM feed_sources WHERE id = $1", [id]);
      return rows[0];
    }

    async function sourcesAt(address: string) {
      const { rows } = await pool.query(
        "SELECT id FROM feed_sources WHERE address = $1",
        [address],
      );
      return rows.length;
    }

    /**
     * A network entry of the source as the Telegram connector writes it —
     * permalink of its smallest message id, `source_ref` `<source>:<id>` —
     * dated in the far future (past every other suite's window) so it heads
     * the public feed's first page, as a `post` card (EARS-33).
     */
    async function entry(
      source: { id: string; address: string },
      messageId: number,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, source_name, href, published_at)
         VALUES ('telegram', $1, $2, 'post', $3, 'BBM Academy · Telegram', $4,
                 '2999-01-01T00:00:00Z'::timestamptz + ($5 || ' seconds')::interval)
         RETURNING id`,
        [
          `${source.id}:${messageId}`,
          source.id,
          `Пост ${messageId}`,
          `https://t.me/${source.address}/${messageId}`,
          String(messageId),
        ],
      );
      return rows[0]!.id;
    }

    /**
     * An own-material entry (`academy`, no source) dated in the far future so
     * it heads the public feed's first page — the platform the card contract
     * renders, so each row-local mark is proven on a row the read would
     * otherwise serve.
     */
    async function academyEntry(n: number): Promise<string> {
      const slug = `e2e-feed-sources-${randomUUID().slice(0, 8)}`;
      const material = await pool.query<{ id: string }>(
        `INSERT INTO materials (slug, kind, title, author_line, body, status, first_published_at)
         VALUES ($1, 'news', $2, '', $3::jsonb, 'published', '2999-06-01T00:00:00Z')
         RETURNING id`,
        [
          slug,
          `Материал ${n}`,
          JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: slug }] },
            ],
          }),
        ],
      );
      const materialId = material.rows[0]!.id;
      materialIds.push(materialId);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, material_id, kind, title, source_name, href, published_at)
         VALUES ('academy', $1::text, $1::text::uuid, 'news', $2, 'Академия', $3,
                 '2999-06-01T00:00:00Z'::timestamptz + ($4 || ' seconds')::interval)
         RETURNING id`,
        [materialId, `Материал ${n}`, `/materials/${slug}`, String(n)],
      );
      return rows[0]!.id;
    }

    async function entryRows(sourceId: string) {
      const { rows } = await pool.query<{
        id: string;
        href: string;
        source_off: boolean;
      }>(
        "SELECT id, href, source_off FROM feed_entries WHERE feed_source_id = $1 ORDER BY source_ref",
        [sourceId],
      );
      return rows;
    }

    async function publicFeedIds(): Promise<string[]> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/feed?limit=24",
      });
      expect(res.statusCode, res.payload).toBe(200);
      return (json(res) as { data: { id: string }[] }).data.map((c) => c.id);
    }

    async function sourceAudit(id: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE event_type LIKE 'data.feed_sources.%' AND metadata->'pk'->>'id' = $1
          ORDER BY created_at`,
        [id],
      );
      return rows;
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
          .overrideProvider(TELEGRAM_CONFIG)
          .useValue({ botToken: "123456:E2E-sources_token" })
          .overrideProvider(TELEGRAM_BOT_API)
          .useValue(telegram),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      // The update poller answered a moment ago: delivery works (EARS-31).
      await markPolled(pool, telegram);
      ({ sid: adminSid, sub: adminSub } = await adminSession());
    });

    afterEach(async () => {
      resetTelegram();
      for (const id of sourceIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
      for (const id of materialIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE material_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM materials WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await dropCursor(pool, telegram);
      await app.close();
    });

    // ── EARS-20: the source list ─────────────────────────────────────────

    it("048 EARS-20: when a platform administrator opens «Источники», the system shall list every source with its platform, address, state, status, check time and post count", async () => {
      const a = await add(username());
      const b = await add(username());
      await entry(a, 101);
      await entry(a, 102);
      const res = await call("GET", "/v1/admin/feed-sources");
      expect(res.statusCode, res.payload).toBe(200);
      const list = json(res) as { data: Source[] };
      const byId = new Map(list.data.map((s) => [s.id, s]));
      expect(byId.get(a.id)).toMatchObject({
        platform: "telegram",
        address: a.address,
        enabled: true,
        status: "failing",
        statusReason: NOT_FOUND,
        entryCount: 2,
        version: 1,
      });
      expect(byId.get(a.id)!.checkedAt).not.toBeNull();
      expect(byId.get(a.id)).toMatchObject({});
      expect(byId.get(b.id)).toMatchObject({ entryCount: 0 });
    });

    // ── EARS-21: add and edit the address ────────────────────────────────

    it("048 EARS-21: when a platform administrator adds a source, the system shall store the lowercase username switched on for each accepted address form and check it at once", async () => {
      for (const form of [
        (n: string) => `https://t.me/${n.toUpperCase()}`,
        (n: string) => `t.me/${n}`,
        (n: string) => `@${n}`,
        (n: string) => n,
      ]) {
        const name = username();
        const res = await call("POST", "/v1/admin/feed-sources", {
          payload: { platform: "telegram", address: form(name) },
        });
        expect(res.statusCode, res.payload).toBe(201);
        const body = json(res) as Source;
        sourceIds.push(body.id);
        expect(body).toMatchObject({
          address: name,
          enabled: true,
          status: "failing",
          statusReason: NOT_FOUND,
          version: 1,
        });
        expect(res.headers.etag).toBe('W/"1"');
        expect(res.headers.location).toBe(`/v1/admin/feed-sources/${body.id}`);
        expect(await sourceRow(body.id)).toMatchObject({
          address: name,
          enabled: true,
          status: "failing",
        });
      }
    });

    it("048 EARS-21: when the address is an invite link or another form, the system shall refuse it with a field error and store nothing", async () => {
      const before = await pool.query(
        "SELECT count(*)::int AS n FROM feed_sources",
      );
      for (const address of [
        "https://t.me/+AbCdEfGh123",
        "https://t.me/joinchat/AbCdEfGh123",
        "https://example.com/bbmacademy",
        "abc",
      ]) {
        const res = await call("POST", "/v1/admin/feed-sources", {
          payload: { platform: "telegram", address },
        });
        expect(res.statusCode, address).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
        expect(problem(res).errors).toEqual([
          { path: "address", message: FEED_SOURCE_ADDRESS_ERROR },
        ]);
      }
      const after = await pool.query(
        "SELECT count(*)::int AS n FROM feed_sources",
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("048 EARS-21: when the address is already listed for that platform, in any form, the system shall refuse it with a field error and store nothing", async () => {
      const name = username();
      await add(name);
      for (const address of [name, `@${name.toUpperCase()}`, `t.me/${name}`]) {
        const res = await call("POST", "/v1/admin/feed-sources", {
          payload: { platform: "telegram", address },
        });
        expect(res.statusCode, res.payload).toBe(400);
        expect(problem(res).errors).toEqual([
          { path: "address", message: FEED_SOURCE_ADDRESS_TAKEN_ERROR },
        ]);
      }
      expect(await sourcesAt(name)).toBe(1);
    });

    it("048 EARS-21: when the address of a source with entries changes, the system shall rewrite the href of each of its entries in the same transaction", async () => {
      const s = await add(username());
      const other = await add(username());
      await entry(s, 1201);
      await entry(s, 1203);
      await entry(other, 1201);
      const renamed = username();
      const res = await edit(s, `https://t.me/${renamed}`);
      expect(res.statusCode, res.payload).toBe(200);
      const body = json(res) as Source;
      expect(body).toMatchObject({
        address: renamed,
        version: 2,
        status: "failing",
        statusReason: NOT_FOUND,
        entryCount: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');
      expect((await entryRows(s.id)).map((e) => e.href)).toEqual([
        `https://t.me/${renamed}/1201`,
        `https://t.me/${renamed}/1203`,
      ]);
      // Another source's entries are not touched.
      expect((await entryRows(other.id)).map((e) => e.href)).toEqual([
        `https://t.me/${other.address}/1201`,
      ]);
    });

    it("048 EARS-21: when an edit names an address another source holds or an invalid one, the system shall refuse it and change neither the source nor its entries", async () => {
      const s = await add(username());
      const taken = await add(username());
      await entry(s, 7);
      const dup = await edit(s, `@${taken.address}`);
      expect(dup.statusCode, dup.payload).toBe(400);
      expect(problem(dup).errors).toEqual([
        { path: "address", message: FEED_SOURCE_ADDRESS_TAKEN_ERROR },
      ]);
      const invite = await edit(s, "https://t.me/+AbCdEf");
      expect(invite.statusCode).toBe(400);
      expect(problem(invite).errors).toEqual([
        { path: "address", message: FEED_SOURCE_ADDRESS_ERROR },
      ]);
      expect(await sourceRow(s.id)).toMatchObject({
        address: s.address,
        version: 1,
      });
      expect((await entryRows(s.id)).map((e) => e.href)).toEqual([
        `https://t.me/${s.address}/7`,
      ]);
    });

    // ── EARS-22: switch off and on ───────────────────────────────────────

    it("048 EARS-22: when a platform administrator switches a source off, the system shall in one transaction mark it off and each of its entries, so its posts leave the public feed and stay listed", async () => {
      const s = await add(username());
      const e1 = await entry(s, 1);
      const e2 = await entry(s, 2);
      const off = await write(s, "disable");
      expect(off.statusCode, off.payload).toBe(200);
      const body = json(off) as Source;
      expect(body).toMatchObject({ enabled: false, version: 2, entryCount: 2 });
      expect(off.headers.etag).toBe('W/"2"');
      expect((await entryRows(s.id)).map((e) => e.source_off)).toEqual([
        true,
        true,
      ]);
      const ids = await publicFeedIds();
      expect(ids).not.toContain(e1);
      expect(ids).not.toContain(e2);

      const again = await write(body, "disable");
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
    });

    it("048 EARS-22: when a platform administrator switches a source on, the system shall in one transaction clear the mark of each of its entries", async () => {
      const s = await add(username());
      await entry(s, 1);
      const off = json(await write(s, "disable")) as Source;
      const on = await write(off, "enable");
      expect(on.statusCode, on.payload).toBe(200);
      expect(json(on)).toMatchObject({ enabled: true, version: 3 });
      expect(await sourceRow(s.id)).toMatchObject({ enabled: true });
      expect((await entryRows(s.id)).map((e) => e.source_off)).toEqual([false]);
      const again = await write(json(on) as Source, "enable");
      expect(again.statusCode).toBe(409);
    });

    it("048 EARS-22: an entry that is only hidden (its source on) is absent from the public feed on its own, while a sibling entry is served", async () => {
      const shown = await academyEntry(1);
      const hidden = await academyEntry(2);
      await pool.query(
        "UPDATE feed_entries SET hidden_at = now() WHERE id = $1",
        [hidden],
      );
      expect(
        (
          await pool.query<{ source_off: boolean }>(
            "SELECT source_off FROM feed_entries WHERE id = $1",
            [hidden],
          )
        ).rows[0],
      ).toEqual({ source_off: false });
      const ids = await publicFeedIds();
      expect(ids).toContain(shown);
      expect(ids).not.toContain(hidden);
    });

    it("048 EARS-22: an entry that only carries the switched-off-source mark (not hidden) is absent from the public feed on its own, while a sibling entry is served", async () => {
      const shown = await academyEntry(3);
      const off = await academyEntry(4);
      await pool.query(
        "UPDATE feed_entries SET source_off = true WHERE id = $1",
        [off],
      );
      expect(
        (
          await pool.query<{ hidden_at: Date | null }>(
            "SELECT hidden_at FROM feed_entries WHERE id = $1",
            [off],
          )
        ).rows[0],
      ).toEqual({ hidden_at: null });
      const ids = await publicFeedIds();
      expect(ids).toContain(shown);
      expect(ids).not.toContain(off);
    });

    it("048 EARS-33: a visible telegram entry of a source that is on is served by the feed read as a post card, beside the own materials", async () => {
      const s = await add(username());
      const post = await entry(s, 9);
      expect(
        (
          await pool.query<{ hidden_at: Date | null; source_off: boolean }>(
            "SELECT hidden_at, source_off FROM feed_entries WHERE id = $1",
            [post],
          )
        ).rows[0],
      ).toEqual({ hidden_at: null, source_off: false });
      const shown = await academyEntry(5);
      const ids = await publicFeedIds();
      expect(ids).toContain(shown);
      expect(ids).toContain(post);
    });

    // ── EARS-23: authz, idempotency, If-Match, audit ─────────────────────

    it("048 EARS-23: when the caller has no admin session, only a portal session or no second factor, every source endpoint shall refuse it and write nothing", async () => {
      const s = await add(username());
      const email = uniqueEmail("src-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const portal = await signIn(app, email, password, { device });
      // An administrator past the password but without the second factor holds
      // only the pending-authentication cookie.
      const pendingAdmin = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("src-pending"),
        password,
        consent,
      });
      await fake.grantProjectRole(pendingAdmin.sub, "platform_admin");
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: device,
        payload: { identifier: pendingAdmin.email, password },
      });
      expect(login.statusCode).toBe(200);
      const pending = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      );
      expect(pending).toBeDefined();

      const routes: [string, string][] = [
        ["GET", "/v1/admin/feed-sources"],
        ["POST", "/v1/admin/feed-sources"],
        ["PATCH", `/v1/admin/feed-sources/${s.id}`],
        ["POST", `/v1/admin/feed-sources/${s.id}/disable`],
        ["POST", `/v1/admin/feed-sources/${s.id}/enable`],
      ];
      for (const [method, url] of routes) {
        for (const cookie of [
          undefined,
          `${SESSION_COOKIE_NAME}=${portal}`,
          `${ADMIN_PENDING_COOKIE_NAME}=${pending!.value}`,
        ]) {
          const res = await app.inject({
            method: method as "GET",
            url,
            headers: {
              ...device,
              "content-type": "application/json",
              "idempotency-key": randomUUID(),
              "if-match": 'W/"1"',
              ...(cookie ? { cookie } : {}),
            },
            payload:
              method === "GET"
                ? undefined
                : { platform: "telegram", address: username() },
          });
          expect(res.statusCode, `${method} ${url} ${cookie ?? ""}`).toBe(401);
        }
      }
      expect(await sourceRow(s.id)).toMatchObject({
        version: 1,
        enabled: true,
        address: s.address,
      });
    });

    it("048 EARS-23: when an admin session no longer holds platform_admin, every source write shall be refused with 403", async () => {
      const other = await adminSession();
      const s = await add(username());
      await fake.revokeProjectRole(other.sub, "platform_admin");
      const name = username();
      // Every write re-establishes the role against the live IdP; the list is
      // a fast-path read, like the material list.
      for (const res of [
        await call("POST", "/v1/admin/feed-sources", {
          sid: other.sid,
          payload: { platform: "telegram", address: name },
        }),
        await edit(s, username(), { sid: other.sid }),
        await write(s, "disable", { sid: other.sid }),
        await write(s, "enable", { sid: other.sid }),
      ]) {
        expect(res.statusCode, res.payload).toBe(403);
      }
      expect(await sourcesAt(name)).toBe(0);
      expect(await sourceRow(s.id)).toMatchObject({ version: 1 });
    });

    it("048 EARS-23: when a write carries no idempotency key, no If-Match or a stale one, the system shall refuse it and change nothing", async () => {
      const name = username();
      const missingKey = await call("POST", "/v1/admin/feed-sources", {
        payload: { platform: "telegram", address: name },
        idempotencyKey: null,
      });
      expect(missingKey.statusCode).toBe(428);
      expect(problem(missingKey).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(await sourcesAt(name)).toBe(0);

      const s = await add(username());
      for (const res of [
        await edit(s, username(), { idempotencyKey: null }),
        await write(s, "disable", { idempotencyKey: null }),
        await call("PATCH", `/v1/admin/feed-sources/${s.id}`, {
          payload: { address: username() },
        }),
        await call("POST", `/v1/admin/feed-sources/${s.id}/disable`),
        await call("POST", `/v1/admin/feed-sources/${s.id}/enable`),
      ]) {
        expect(res.statusCode, res.payload).toBe(428);
      }
      for (const res of [
        await edit({ id: s.id, version: 9 }, username()),
        await write({ id: s.id, version: 9 }, "disable"),
      ]) {
        expect(res.statusCode, res.payload).toBe(412);
        expect(problem(res).errorCode).toBe("PRECONDITION_FAILED");
      }
      expect(await sourceRow(s.id)).toMatchObject({
        version: 1,
        enabled: true,
        address: s.address,
      });
    });

    it("048 EARS-23: when the same key is retried with identical input, the system shall replay the response and store no second source", async () => {
      const k = key();
      const name = username();
      const payload = { platform: "telegram", address: name };
      const first = await call("POST", "/v1/admin/feed-sources", {
        payload,
        idempotencyKey: k,
      });
      expect(first.statusCode).toBe(201);
      sourceIds.push(json(first).id);
      const replay = await call("POST", "/v1/admin/feed-sources", {
        payload,
        idempotencyKey: k,
      });
      expect(replay.statusCode).toBe(201);
      expect(json(replay).id).toBe(json(first).id);
      expect(await sourcesAt(name)).toBe(1);
    });

    // ── EARS-21: the at-once source check (EARS-31) ──────────────────────

    /** A channel the double knows, the bot its administrator. */
    function knownChannel(address: string, chatId: number) {
      const info = { id: chatId, type: "channel", username: address };
      telegram.chats.set(`@${address}`, info);
      telegram.chats.set(String(chatId), info);
      telegram.members.set(`${chatId}:${telegram.me.id}`, {
        status: "administrator",
      });
    }
    const boundId = async (id: string) =>
      (
        await pool.query<{ telegram_chat_id: string | null }>(
          "SELECT telegram_chat_id FROM feed_sources WHERE id = $1",
          [id],
        )
      ).rows[0]!.telegram_chat_id;

    it("048 EARS-21: when a source is added, the system shall run the source check at once, so the response carries «Работает» and the Telegram id is bound before any import", async () => {
      const name = username();
      const chatId = -1_000_000_000_000 - Math.floor(Math.random() * 1e9);
      knownChannel(name, chatId);
      const res = await call("POST", "/v1/admin/feed-sources", {
        payload: { platform: "telegram", address: `https://t.me/${name}` },
      });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as Source;
      sourceIds.push(body.id);
      expect(body).toMatchObject({
        status: "ok",
        statusReason: null,
        version: 1,
      });
      expect(body.checkedAt).not.toBeNull();
      // The check is not an administrator edit: the ETag stays the write's.
      expect(res.headers.etag).toBe('W/"1"');
      expect(await boundId(body.id)).toBe(String(chatId));
      expect(telegram.calls.map((c) => c.method)).toEqual([
        "getMe",
        "getChat",
        "getChatMember",
      ]);
    });

    it("048 EARS-21: when an address is edited or a source switched on, the system shall run the source check at once; a failed or unreachable check never fails the write", async () => {
      const s = await add(username());
      expect(s).toMatchObject({ status: "failing", statusReason: NOT_FOUND });
      const renamed = username();
      const chatId = -1_000_000_000_000 - Math.floor(Math.random() * 1e9);
      knownChannel(renamed, chatId);
      const edited = await edit(s, renamed);
      expect(edited.statusCode, edited.payload).toBe(200);
      expect(json(edited)).toMatchObject({
        address: renamed,
        status: "ok",
        version: 2,
      });
      expect(await boundId(s.id)).toBe(String(chatId));
      // «Выключить» runs no check.
      telegram.calls.length = 0;
      const off = json(
        await write(json(edited) as Source, "disable"),
      ) as Source;
      expect(off).toMatchObject({ enabled: false, status: "ok" });
      expect(telegram.calls).toEqual([]);
      telegram.outage = "timeout";
      const on = await write(off, "enable");
      expect(on.statusCode, on.payload).toBe(200);
      expect(json(on)).toMatchObject({
        enabled: true,
        status: "failing",
        statusReason: SOURCE_CHECK_REASONS.unreachable,
        version: 4,
      });
    });

    it("048 EARS-23: when a source is added, edited, switched off and on, each write shall leave its 010 audit row under the acting administrator, and the at-once check its own", async () => {
      const s = await add(username());
      await entry(s, 1);
      // The add and its at-once check.
      expect(await sourceAudit(s.id)).toHaveLength(2);
      const edited = json(await edit(s, username())) as Source;
      expect(await sourceAudit(s.id)).toHaveLength(4);
      const off = json(await write(edited, "disable")) as Source;
      expect(await sourceAudit(s.id)).toHaveLength(5);
      await write(off, "enable");
      const rows = await sourceAudit(s.id);
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.feed_sources.insert",
        "data.feed_sources.update",
        "data.feed_sources.update",
        "data.feed_sources.update",
        "data.feed_sources.update",
        "data.feed_sources.update",
        "data.feed_sources.update",
      ]);
      // `subject_id` is the acting administrator's opaque IdP `sub`.
      for (const r of rows) expect(r.subject_id).toBe(adminSub);
    });

    // ── EARS-32: «Публикации» — hide and return one post ─────────────────

    /** Seconds since the epoch of a delivered post: an hour ago plus its id. */
    const postBase = Math.floor(Date.now() / 1000) - 3600;
    let updateSeq = Math.floor(Math.random() * 1e6) + 7_000_000;

    /** A channel message of the source as the Bot API delivers it. */
    function channelMessage(
      s: { address: string; chatId: number },
      messageId: number,
      text: string,
    ) {
      return {
        message_id: messageId,
        date: postBase + messageId,
        chat: {
          id: s.chatId,
          type: "channel",
          username: s.address,
          title: "BBM Academy",
        },
        sender_chat: { id: s.chatId, type: "channel" },
        text,
      };
    }

    /** Deliver one update through one poll of the update poller. */
    async function deliverUpdate(
      kind: "channel_post" | "edited_channel_post",
      msg: unknown,
    ): Promise<void> {
      const outcome = await deliverByPoll(app, telegram, {
        update_id: ++updateSeq,
        [kind]: msg,
      });
      expect(outcome).toEqual({ kind: "polled", processed: 1 });
    }

    /** A source with posts delivered through the real ingress path. */
    async function sourceWithPosts(
      posts: [number, string][],
    ): Promise<Source & { chatId: number }> {
      const s = await add(username());
      const chatId = -1_000_000_000_000 - Math.floor(Math.random() * 1e9);
      for (const [id, text] of posts) {
        await deliverUpdate(
          "channel_post",
          channelMessage({ ...s, chatId }, id, text),
        );
      }
      return { ...s, chatId };
    }

    type EntryItem = {
      id: string;
      text: string;
      publishedAt: string;
      state: "in_feed" | "hidden" | "source_off";
      hidden: boolean;
      href: string;
      version: number;
    };

    async function listEntries(
      sourceId: string,
      query = "",
      c: Call = {},
    ): Promise<{
      source: Source;
      data: EntryItem[];
      nextCursor: string | null;
    }> {
      const res = await call(
        "GET",
        `/v1/admin/feed-sources/${sourceId}/entries${query}`,
        c,
      );
      expect(res.statusCode, res.payload).toBe(200);
      return json(res);
    }

    const toggle = (
      e: { id: string; version: number },
      action: "hide" | "unhide",
      c: Call = {},
    ) =>
      call("POST", `/v1/admin/feed-entries/${e.id}/${action}`, {
        ifMatch: `W/"${e.version}"`,
        ...c,
      });

    async function entryRow(id: string) {
      const { rows } = await pool.query<{
        hidden_at: Date | null;
        published_at: Date;
        title: string;
      }>(
        "SELECT hidden_at, published_at, title FROM feed_entries WHERE id = $1",
        [id],
      );
      return rows[0]!;
    }

    /**
     * The given ids in the order the public feed serves them (EARS-32,
     * EARS-33): every page is walked from the top down to the oldest of them,
     * so an absent id is absent from the whole read, not just off page one.
     */
    async function publicFeedOrder(ids: string[]): Promise<string[]> {
      const { rows } = await pool.query<{ oldest: Date }>(
        "SELECT min(published_at) AS oldest FROM feed_entries WHERE id = ANY($1::uuid[])",
        [ids],
      );
      const oldest = rows[0]!.oldest.getTime();
      const served: string[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 500; pages += 1) {
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/feed?limit=24${cursor ? `&cursor=${cursor}` : ""}`,
        });
        expect(res.statusCode, res.payload).toBe(200);
        const page = PublicFeedPageSchema.parse(json(res));
        served.push(...page.data.map((c) => c.id));
        const last = page.data.at(-1);
        cursor = page.nextCursor;
        if (!cursor || !last || Date.parse(last.publishedAt) < oldest) break;
      }
      return served.filter((id) => ids.includes(id));
    }

    async function entryAudit(id: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE event_type LIKE 'data.feed_entries.%' AND metadata->'pk'->>'id' = $1
          ORDER BY created_at`,
        [id],
      );
      return rows;
    }

    it("048 EARS-32: when a platform administrator opens «Публикации» of a source, the system shall list its entries newest first with the post text, the date, the state and the link to the original", async () => {
      const s = await sourceWithPosts([
        [1201, "Пост 1201"],
        [1202, "Пост 1202"],
      ]);
      const other = await sourceWithPosts([[1203, "Чужой пост"]]);
      const page = await listEntries(s.id);
      expect(page.nextCursor).toBeNull();
      expect(page.source).toMatchObject({
        id: s.id,
        address: s.address,
        entryCount: 2,
      });
      expect(page.data.map((e) => e.text)).toEqual(["Пост 1202", "Пост 1201"]);
      expect(page.data[1]).toMatchObject({
        state: "in_feed",
        hidden: false,
        href: `https://t.me/${s.address}/1201`,
        publishedAt: new Date((postBase + 1201) * 1000).toISOString(),
      });
      expect(page.data[1]!.version).toBeGreaterThan(0);
      expect(page.data.map((e) => e.id)).not.toContain(
        (await listEntries(other.id)).data[0]!.id,
      );

      // Newest first, one page at a time.
      const first = await listEntries(s.id, "?limit=1");
      expect(first.data.map((e) => e.text)).toEqual(["Пост 1202"]);
      expect(first.nextCursor).not.toBeNull();
      const second = await listEntries(
        s.id,
        `?limit=1&cursor=${first.nextCursor}`,
      );
      expect(second.data.map((e) => e.text)).toEqual(["Пост 1201"]);
      expect(second.nextCursor).toBeNull();

      // A switched-off source's posts read «Источник выключен».
      await write(s, "disable");
      const off = await listEntries(s.id);
      expect(off.data.map((e) => e.state)).toEqual([
        "source_off",
        "source_off",
      ]);

      // An unknown source and a mangled cursor are refused.
      const missing = await call(
        "GET",
        `/v1/admin/feed-sources/${randomUUID()}/entries`,
      );
      expect(missing.statusCode).toBe(404);
      const badCursor = await call(
        "GET",
        `/v1/admin/feed-sources/${s.id}/entries?cursor=bm90LWEtY3Vyc29y`,
      );
      expect(badCursor.statusCode).toBe(400);
    });

    it("048 EARS-32: when the administrator hides a post, the system shall mark it hidden so it leaves the feed and stays listed, an edit shall not bring it back, and «Вернуть в ленту» returns it at its own date", async () => {
      const s = await sourceWithPosts([
        [1201, "Пост 1201"],
        [1202, "Пост 1202"],
      ]);
      const [p1202, p1201] = (await listEntries(s.id)).data;
      const before = await entryRow(p1202!.id);

      const hidden = await toggle(p1202!, "hide");
      expect(hidden.statusCode, hidden.payload).toBe(200);
      const hiddenItem = json(hidden) as EntryItem;
      expect(hiddenItem).toMatchObject({
        id: p1202!.id,
        state: "hidden",
        hidden: true,
      });
      expect(hidden.headers.etag).toBe(`W/"${hiddenItem.version}"`);
      expect((await entryRow(p1202!.id)).hidden_at).not.toBeNull();
      const pair = [p1202!.id, p1201!.id];
      expect(await publicFeedOrder(pair)).toEqual([p1201!.id]);
      expect(await publicFeedIds()).not.toContain(p1202!.id);
      // Still listed, as «Скрыт»; the sibling untouched.
      let listed = (await listEntries(s.id)).data;
      expect(listed.map((e) => [e.id, e.state])).toEqual([
        [p1202!.id, "hidden"],
        [p1201!.id, "in_feed"],
      ]);

      // An edit of the post rewrites its text and keeps it hidden.
      const hiddenAt = (await entryRow(p1202!.id)).hidden_at;
      await deliverUpdate("edited_channel_post", {
        ...channelMessage(s, 1202, "Пост 1202, исправленный"),
        edit_date: postBase + 5000,
      });
      const edited = await entryRow(p1202!.id);
      expect(edited.title).toBe("Пост 1202, исправленный");
      expect(edited.hidden_at).toEqual(hiddenAt);
      expect(await publicFeedOrder(pair)).toEqual([p1201!.id]);
      expect(await publicFeedIds()).not.toContain(p1202!.id);

      // The edit moved the row: the version read before it is stale.
      const stale = await toggle(hiddenItem, "unhide");
      expect(stale.statusCode, stale.payload).toBe(412);
      listed = (await listEntries(s.id)).data;
      const current = listed.find((e) => e.id === p1202!.id)!;
      expect(current).toMatchObject({
        state: "hidden",
        text: "Пост 1202, исправленный",
      });

      const back = await toggle(current, "unhide");
      expect(back.statusCode, back.payload).toBe(200);
      expect(json(back)).toMatchObject({ state: "in_feed", hidden: false });
      const returned = await entryRow(p1202!.id);
      expect(returned.hidden_at).toBeNull();
      expect(returned.published_at).toEqual(before.published_at);
      // Back in the feed's own order, at its own date ahead of the older post.
      expect(await publicFeedOrder(pair)).toEqual([p1202!.id, p1201!.id]);
      expect((await listEntries(s.id)).data.map((e) => e.id)).toEqual([
        p1202!.id,
        p1201!.id,
      ]);
    });

    it("048 EARS-32: when hide or unhide names an own material, an entry already in that state or an unknown id, the system shall refuse it and change nothing", async () => {
      const own = await academyEntry(32);
      const ownVersion = Number(
        (
          await pool.query<{ v: string }>(
            "SELECT (extract(epoch FROM updated_at) * 1000000)::bigint AS v FROM feed_entries WHERE id = $1",
            [own],
          )
        ).rows[0]!.v,
      );
      for (const action of ["hide", "unhide"] as const) {
        const res = await toggle({ id: own, version: ownVersion }, action);
        expect(res.statusCode, res.payload).toBe(409);
      }
      expect((await entryRow(own)).hidden_at).toBeNull();
      expect(await publicFeedIds()).toContain(own);

      const s = await sourceWithPosts([[1301, "Пост 1301"]]);
      const [p] = (await listEntries(s.id)).data;
      const alreadyShown = await toggle(p!, "unhide");
      expect(alreadyShown.statusCode).toBe(409);
      expect(problem(alreadyShown).errorCode).toBe("INVALID_TRANSITION");
      const hid = json(await toggle(p!, "hide")) as EntryItem;
      const twice = await toggle(hid, "hide");
      expect(twice.statusCode).toBe(409);

      const unknown = await toggle({ id: randomUUID(), version: 1 }, "hide");
      expect(unknown.statusCode).toBe(404);
    });

    it("048 EARS-32: each hide and unhide shall leave one 010 audit row under the acting administrator, and an exact retry replays without a second write", async () => {
      const s = await sourceWithPosts([[1401, "Пост 1401"]]);
      const [p] = (await listEntries(s.id)).data;
      const before = (await entryAudit(p!.id)).length;
      const k = key();
      const first = await toggle(p!, "hide", { idempotencyKey: k });
      expect(first.statusCode, first.payload).toBe(200);
      const replay = await toggle(p!, "hide", { idempotencyKey: k });
      expect(replay.statusCode, replay.payload).toBe(200);
      expect(json(replay)).toEqual(json(first));
      await toggle(json(first) as EntryItem, "unhide");
      const rows = (await entryAudit(p!.id)).slice(before);
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.feed_entries.update",
        "data.feed_entries.update",
      ]);
      for (const r of rows) expect(r.subject_id).toBe(adminSub);
    });

    it("048 EARS-32: «Публикации», hide and unhide shall refuse a caller without the MFA admin session or platform_admin, and a write without its key or If-Match, changing nothing", async () => {
      const s = await sourceWithPosts([[1501, "Пост 1501"]]);
      const [p] = (await listEntries(s.id)).data;
      const email = uniqueEmail("posts-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const portal = await signIn(app, email, password, { device });
      const routes: [string, string][] = [
        ["GET", `/v1/admin/feed-sources/${s.id}/entries`],
        ["POST", `/v1/admin/feed-entries/${p!.id}/hide`],
        ["POST", `/v1/admin/feed-entries/${p!.id}/unhide`],
      ];
      for (const [method, url] of routes) {
        for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=${portal}`]) {
          const res = await app.inject({
            method: method as "GET",
            url,
            headers: {
              ...device,
              "idempotency-key": randomUUID(),
              "if-match": `W/"${p!.version}"`,
              ...(cookie ? { cookie } : {}),
            },
          });
          expect(res.statusCode, `${method} ${url} ${cookie ?? ""}`).toBe(401);
        }
      }

      const other = await adminSession();
      await fake.revokeProjectRole(other.sub, "platform_admin");
      for (const action of ["hide", "unhide"] as const) {
        const res = await toggle(p!, action, { sid: other.sid });
        expect(res.statusCode, res.payload).toBe(403);
      }

      const noKey = await toggle(p!, "hide", { idempotencyKey: null });
      expect(noKey.statusCode).toBe(428);
      expect(problem(noKey).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      const noIfMatch = await call(
        "POST",
        `/v1/admin/feed-entries/${p!.id}/hide`,
      );
      expect(noIfMatch.statusCode).toBe(428);
      const stale = await toggle(
        { id: p!.id, version: p!.version - 1 },
        "hide",
      );
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");
      expect((await entryRow(p!.id)).hidden_at).toBeNull();
    });
  },
);

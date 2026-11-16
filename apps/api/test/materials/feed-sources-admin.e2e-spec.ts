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
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
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

// 048 V-14 (#3993) — the «Источники» admin API over the REAL stack (Fastify +
// the 011 admin session + Postgres): add with the address normalized and the
// duplicate refused, address edit with the `href` rewrite, switch off and on
// with the entry marks in one transaction (EARS-20…EARS-22), and the EARS-23
// floor — `platform_admin` in the MFA admin session, idempotency key,
// `If-Match`, one 010 audit row per write. The source check (EARS-31) is the
// Telegram connector's (#3994): here a new source stays «Не проверен».
// Mirrors the materials admin suite. Skips when the stand is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "048 feed sources admin API (e2e)",
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
     * dated in the far future (past every other suite's window) so it heads the public feed's first page. The
     * `post` kind lands with the connector (#3994), so the fixture is a `news`
     * card; the marks under test are row-local and kind-blind.
     */
    async function entry(
      source: { id: string; address: string },
      messageId: number,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, source_name, href, published_at)
         VALUES ('telegram', $1, $2, 'news', $3, 'BBM Academy · Telegram', $4,
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
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      ({ sid: adminSid, sub: adminSub } = await adminSession());
    });

    afterEach(async () => {
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
        status: "unchecked",
        statusReason: null,
        checkedAt: null,
        entryCount: 2,
        version: 1,
      });
      expect(byId.get(b.id)).toMatchObject({ entryCount: 0 });
    });

    // ── EARS-21: add and edit the address ────────────────────────────────

    it("048 EARS-21: when a platform administrator adds a source, the system shall store the lowercase username switched on and «Не проверен» for each accepted address form", async () => {
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
          status: "unchecked",
          version: 1,
        });
        expect(res.headers.etag).toBe('W/"1"');
        expect(res.headers.location).toBe(`/v1/admin/feed-sources/${body.id}`);
        expect(await sourceRow(body.id)).toMatchObject({
          address: name,
          enabled: true,
          status: "unchecked",
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
        status: "unchecked",
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

    it("048 EARS-10: the feed read serves no entry of a platform the card contract has no member for — a visible telegram entry is not served and the read stays 200", async () => {
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
      expect(ids).not.toContain(post);
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

    it("048 EARS-23: when a source is added, edited, switched off and on, each write shall leave exactly one 010 audit row under the acting administrator", async () => {
      const s = await add(username());
      await entry(s, 1);
      expect(await sourceAudit(s.id)).toHaveLength(1);
      const edited = json(await edit(s, username())) as Source;
      expect(await sourceAudit(s.id)).toHaveLength(2);
      const off = json(await write(edited, "disable")) as Source;
      expect(await sourceAudit(s.id)).toHaveLength(3);
      await write(off, "enable");
      const rows = await sourceAudit(s.id);
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.feed_sources.insert",
        "data.feed_sources.update",
        "data.feed_sources.update",
        "data.feed_sources.update",
      ]);
      // `subject_id` is the acting administrator's opaque IdP `sub`.
      for (const r of rows) expect(r.subject_id).toBe(adminSub);
    });
  },
);

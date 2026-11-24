import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger, VersioningType } from "@nestjs/common";
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
import {
  FEED_VK_SOURCE_ADDRESS_ERROR,
  FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR,
  FeedEntryAdminListSchema,
  FeedSourceAdminListSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeVkApi } from "../../src/materials/vk/vk-api.fake.js";
import { VK_API } from "../../src/materials/vk/vk-api.types.js";
import { VK_CONFIG, type VkConfig } from "../../src/materials/vk/vk-config.js";
import { VK_SOURCE_CHECK_REASONS } from "../../src/materials/vk/vk-source-check.service.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

// 048 V-29, V-30 (#4004) — the «Источники» / «Публикации» admin API for VK
// sources over the REAL stack (Fastify + the 011 admin session + Postgres)
// against the VK double: the VK address rule and its refusals, the
// «already listed» refusal of a community bound to another source (048-design
// Lead decision 16), the at-once check binding the community id (EARS-38),
// the address edit unbinding the previous community, the month's VK calls
// beside the list (EARS-44) and «Удалён в VK» in «Публикации» (EARS-47).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "048 VK sources admin API (e2e)",
  () => {
    const config: VkConfig = {
      serviceKey: "vk1.a.E2E-admin_service_key",
      callbackSecret: "e2e-admin-callback-secret",
      confirmation: "e2e-admin-confirm",
    };
    const vk = new FakeVkApi();
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
    const logged: string[] = [];
    let adminSid: string;

    const key = () => {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    };
    const screenName = () =>
      `e2e_${Math.random().toString(36).slice(2, 10)}`.slice(0, 20);
    const groupId = () => 800_000_000 + Math.floor(Math.random() * 99_000_000);
    /** A community the double knows. */
    function community() {
      const gid = groupId();
      const name = screenName();
      vk.groups.set(gid, { id: gid, screen_name: name });
      return { gid, name };
    }

    interface Call {
      payload?: Record<string, unknown>;
      ifMatch?: string | null;
    }
    function call(method: "POST" | "PATCH" | "GET", url: string, c: Call = {}) {
      return app.inject({
        method,
        url,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          ...(c.payload ? { "content-type": "application/json" } : {}),
          ...(method !== "GET" ? { "idempotency-key": key() } : {}),
          ...(c.ifMatch ? { "if-match": c.ifMatch } : {}),
        },
        ...(c.payload ? { payload: c.payload } : {}),
      });
    }
    const json = (res: { payload: string }) => JSON.parse(res.payload);
    type Source = {
      id: string;
      platform: string;
      address: string;
      status: string;
      statusReason: string | null;
      version: number;
    };

    async function add(address: string) {
      const res = await call("POST", "/v1/admin/feed-sources", {
        payload: { platform: "vk", address },
      });
      if (res.statusCode === 201) sourceIds.push((json(res) as Source).id);
      return res;
    }
    const edit = (s: Source, address: string) =>
      call("PATCH", `/v1/admin/feed-sources/${s.id}`, {
        payload: { address },
        ifMatch: `W/"${s.version}"`,
      });
    async function row(id: string) {
      const { rows } = await pool.query<{
        address: string;
        vk_group_id: string | null;
        vk_last_event_at: Date | null;
      }>("SELECT * FROM feed_sources WHERE id = $1", [id]);
      return rows[0]!;
    }
    const countAt = async (address: string) =>
      (
        await pool.query("SELECT 1 FROM feed_sources WHERE address = $1", [
          address,
        ])
      ).rowCount;
    function postEvent(gid: number, id: number) {
      return app.inject({
        method: "POST",
        url: "/v1/integrations/vk/callback",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          type: "wall_post_new",
          group_id: gid,
          event_id: randomUUID().slice(0, 12),
          object: {
            id,
            owner_id: -gid,
            date: Math.floor(Date.now() / 1000) - 60,
            text: `Пост ${id}`,
            post_type: "post",
          },
          secret: config.callbackSecret,
        }),
      });
    }
    const titles = async (sourceId: string) =>
      (
        await pool.query<{ title: string }>(
          "SELECT title FROM feed_entries WHERE feed_source_id = $1 ORDER BY title",
          [sourceId],
        )
      ).rows.map((r) => r.title);

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .overrideProvider(VK_CONFIG)
          .useValue(config)
          .overrideProvider(VK_API)
          .useValue(vk),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      const email = `vk-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const { sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => email,
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      ({ sid: adminSid } = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      }));
    });

    beforeEach(() => {
      vk.reset();
      logged.length = 0;
      for (const level of ["log", "warn", "error"] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            logged.push(args.map((a) => String(a)).join(" "));
          },
        );
      }
    });

    afterEach(async () => {
      for (const s of Object.values(config)) {
        expect(logged.join("\n")).not.toContain(s);
      }
      vi.restoreAllMocks();
      for (const id of sourceIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    it("048 EARS-38: when a platform administrator adds a VK source in each accepted form, the system shall store the lowercase screen name switched on, check it at once and bind its community id", async () => {
      const forms = (n: string) => [
        `https://vk.com/${n.toUpperCase()}`,
        `vk.com/${n}`,
        `https://vk.ru/${n}`,
        `vk.ru/${n}`,
        n,
      ];
      for (let i = 0; i < 5; i += 1) {
        const c = community();
        const res = await add(forms(c.name)[i]!);
        expect(res.statusCode, res.payload).toBe(201);
        const body = json(res) as Source;
        expect(body).toMatchObject({
          platform: "vk",
          address: c.name,
          status: "ok",
          statusReason: null,
        });
        expect(Number((await row(body.id)).vk_group_id)).toBe(c.gid);
      }
      // club<id> of a community without a short name.
      const gid = groupId();
      vk.groups.set(gid, { id: gid, screen_name: `club${gid}` });
      const club = await add(`club${gid}`);
      expect(club.statusCode, club.payload).toBe(201);
      expect(Number((await row((json(club) as Source).id)).vk_group_id)).toBe(
        gid,
      );
    });

    it("048 EARS-38: when the address is of another form, the system shall refuse it with a field error and store nothing", async () => {
      for (const bad of [
        "https://vk.com/wall-1_2",
        "vk.com/video-1_2",
        "https://vk.com/id12345",
        "https://t.me/channel",
        "vk.com/a",
        "https://example.com/name",
      ]) {
        const res = await add(bad);
        expect(res.statusCode, bad).toBe(400);
        expect(json(res).errors).toEqual([
          { path: "address", message: FEED_VK_SOURCE_ADDRESS_ERROR },
        ]);
      }
      expect(vk.calls).toEqual([]);
    });

    it("048 EARS-38: when the address, or the community it names, is already listed for VK, the system shall refuse with «Это сообщество уже есть в списке» and store nothing", async () => {
      const c = community();
      expect((await add(c.name)).statusCode).toBe(201);
      const again = await add(`vk.com/${c.name}`);
      expect(again.statusCode).toBe(400);
      expect(json(again).errors).toEqual([
        { path: "address", message: FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR },
      ]);
      // club<id> of the same, already bound community: «already listed»,
      // never «Сообщество не найдено».
      const byId = await add(`club${c.gid}`);
      expect(byId.statusCode, byId.payload).toBe(400);
      expect(json(byId).errors).toEqual([
        { path: "address", message: FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR },
      ]);
      expect(await countAt(`club${c.gid}`)).toBe(0);
    });

    it("048 EARS-38: when an administrator edits a VK address to another community, the system shall unbind the previous one and bind the new one, so the previous community's events are dropped and the new one's accepted", async () => {
      const oldC = community();
      const newC = community();
      const created = json(await add(oldC.name)) as Source;
      expect((await postEvent(oldC.gid, 1)).payload).toBe("ok");
      const res = await edit(created, `https://vk.com/${newC.name}`);
      expect(res.statusCode, res.payload).toBe(200);
      expect(json(res)).toMatchObject({ address: newC.name, status: "ok" });
      expect(Number((await row(created.id)).vk_group_id)).toBe(newC.gid);
      logged.length = 0;
      expect((await postEvent(oldC.gid, 2)).payload).toBe("ok");
      expect(logged.join("\n")).toContain('"reason":"unlisted"');
      expect((await postEvent(newC.gid, 3)).payload).toBe("ok");
      expect(await titles(created.id)).toEqual(["Пост 1", "Пост 3"]);
    });

    it("048 EARS-38: when an edited VK address is of another form or names a community bound to another source, the system shall refuse it and change nothing", async () => {
      const a = community();
      const b = community();
      const first = json(await add(a.name)) as Source;
      const second = json(await add(b.name)) as Source;
      const bad = await edit(first, "vk.com/wall-1_1");
      expect(bad.statusCode).toBe(400);
      expect(json(bad).errors).toEqual([
        { path: "address", message: FEED_VK_SOURCE_ADDRESS_ERROR },
      ]);
      const taken = await edit(first, `public${b.gid}`);
      expect(taken.statusCode).toBe(400);
      expect(json(taken).errors).toEqual([
        { path: "address", message: FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR },
      ]);
      expect(await row(first.id)).toMatchObject({ address: a.name });
      expect(Number((await row(first.id)).vk_group_id)).toBe(a.gid);
      expect(Number((await row(second.id)).vk_group_id)).toBe(b.gid);
    });

    it("048 EARS-44: «Источники» shall show the VK calls of the current month and the check's VK reason", async () => {
      const unknown = json(await add(screenName())) as Source;
      expect(unknown).toMatchObject({
        status: "failing",
        statusReason: VK_SOURCE_CHECK_REASONS.communityNotFound,
      });
      const res = await call("GET", "/v1/admin/feed-sources");
      expect(res.statusCode).toBe(200);
      const list = FeedSourceAdminListSchema.parse(json(res));
      expect(list.vkCallsThisMonth).toBeGreaterThanOrEqual(0);
      expect(list.data.find((s) => s.id === unknown.id)).toMatchObject({
        platform: "vk",
        statusReason: VK_SOURCE_CHECK_REASONS.communityNotFound,
      });
    });

    it("048 EARS-47: when an administrator opens «Публикации» of a VK source, the system shall list its posts and videos with «Удалён в VK» for a removed entry, and hide applies unchanged", async () => {
      const c = community();
      const src = json(await add(c.name)) as Source;
      await postEvent(c.gid, 10);
      await postEvent(c.gid, 11);
      await pool.query(
        "UPDATE feed_entries SET removed_at = now() WHERE feed_source_id = $1 AND title = 'Пост 10'",
        [src.id],
      );
      const res = await call("GET", `/v1/admin/feed-sources/${src.id}/entries`);
      expect(res.statusCode, res.payload).toBe(200);
      const page = FeedEntryAdminListSchema.parse(json(res));
      const byText = new Map(page.data.map((e) => [e.text, e]));
      expect(byText.get("Пост 10")).toMatchObject({
        kind: "post",
        state: "removed",
        hidden: false,
      });
      expect(byText.get("Пост 11")).toMatchObject({
        kind: "post",
        state: "in_feed",
      });
      const target = byText.get("Пост 10")!;
      const hidden = await call(
        "POST",
        `/v1/admin/feed-entries/${target.id}/hide`,
        {
          ifMatch: `W/"${target.version}"`,
        },
      );
      expect(hidden.statusCode, hidden.payload).toBe(200);
      expect(json(hidden)).toMatchObject({
        state: "hidden",
        hidden: true,
        kind: "post",
      });
    });
  },
);

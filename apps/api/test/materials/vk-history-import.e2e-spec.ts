import { Test } from "@nestjs/testing";
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
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeVkApi } from "../../src/materials/vk/vk-api.fake.js";
import { VK_API } from "../../src/materials/vk/vk-api.types.js";
import { VkCallMonthsRepository } from "../../src/materials/vk/vk-call-months.repository.js";
import { VK_CONFIG, type VkConfig } from "../../src/materials/vk/vk-config.js";
import {
  VK_CALL_BUDGET_REASON,
  VK_UNBOUND_SOURCE_REASON,
  VkHistoryImport,
  VkHistoryImportRefusedError,
} from "../../src/materials/vk/vk-history-import.command.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-29 (#4005) — the one-off VK wall history import over the REAL stack
// (Fastify + Postgres) against the paged VK double: `wall.get` pages of 100 by
// `offset` over the whole wall, each post mapped under EARS-41 and written
// through `feed_entry_vk_objects` (EARS-43), so a re-run, a post the Callback
// delivered and a hidden entry are never duplicated or touched; an unbound
// source is refused with nothing written; the import stops before the month's
// calls pass 8 000. The command runs through its unit — the operator entry
// (`src/materials/vk/vk-history-import.main.ts`) only parses arguments and
// prints the report. The double counts every call into the real month counter,
// as the real client does.
describe.skipIf(!process.env.DATABASE_URL)(
  "048 VK history import (e2e)",
  () => {
    const config: VkConfig = {
      serviceKey: "vk1.a.E2E-import_service_key",
      callbackSecret: "e2e-import-callback-secret",
      confirmation: "e2e-import-confirm",
    };
    const vk = new FakeVkApi();
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let importer: VkHistoryImport;
    const sourceIds: string[] = [];
    const logged: string[] = [];
    const base = 1_730_000_000;
    const MONTH =
      "date_trunc('month', now() AT TIME ZONE 'Europe/Moscow')::date";
    let callsBefore: number | null = null;

    const screenName = () =>
      `imp_${Math.random().toString(36).slice(2, 10)}`.slice(0, 20);
    const groupId = () => 800_000_000 + Math.floor(Math.random() * 99_000_000);

    async function source(opts: { bound?: boolean; enabled?: boolean } = {}) {
      const gid = groupId();
      const address = screenName();
      const bound = opts.bound ?? true;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_sources (platform, address, enabled, vk_group_id, vk_last_event_at)
         VALUES ('vk', $1, $2, $3, $4) RETURNING id`,
        [
          address,
          opts.enabled ?? true,
          bound ? gid : null,
          bound ? new Date() : null,
        ],
      );
      sourceIds.push(rows[0]!.id);
      vk.groups.set(gid, { id: gid, screen_name: address });
      return { id: rows[0]!.id, address, gid };
    }
    type Src = Awaited<ReturnType<typeof source>>;

    const wallPost = (src: Src, id: number, over: object = {}) => ({
      id,
      owner_id: -src.gid,
      date: base + id * 60,
      text: `Пост ${id}`,
      post_type: "post",
      created_by: 777_101,
      signer_id: 777_102,
      from_id: -src.gid,
      attachments: [
        {
          type: "photo",
          photo: {
            id: id,
            owner_id: -src.gid,
            sizes: [
              {
                url: `https://sun9-1.userapi.com/p${id}.jpg`,
                width: 1080,
                height: 600,
              },
            ],
          },
        },
      ],
      ...over,
    });
    const repost = (src: Src, id: number) =>
      wallPost(src, id, { post_type: "copy", copy_history: [{ id: 1 }] });

    function callback(object: unknown, gid: number) {
      return app.inject({
        method: "POST",
        url: "/v1/integrations/vk/callback",
        headers: { "content-type": "application/json", "x-retry-counter": "0" },
        payload: JSON.stringify({
          type: "wall_post_new",
          group_id: gid,
          event_id: `imp${Math.random().toString(36).slice(2, 10)}`,
          v: "5.199",
          object,
          secret: config.callbackSecret,
        }),
      });
    }

    async function entries(sourceId: string) {
      const { rows } = await pool.query<{
        id: string;
        kind: string;
        title: string;
        href: string;
        image_url: string | null;
        published_at: Date;
        hidden_at: Date | null;
        source_off: boolean;
        updated_at: Date;
      }>(
        "SELECT * FROM feed_entries WHERE feed_source_id = $1 ORDER BY published_at, id",
        [sourceId],
      );
      return rows;
    }
    const wallGets = () => vk.calls.filter((c) => c.method === "wall.get");
    async function setCalls(n: number) {
      await pool.query(
        `INSERT INTO feed_vk_call_months (month, calls) VALUES (${MONTH}, $1)
         ON CONFLICT (month) DO UPDATE SET calls = $1`,
        [n],
      );
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(VK_CONFIG)
        .useValue(config)
        .overrideProvider(VK_API)
        .useValue(vk)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      importer = app.get(VkHistoryImport);
      const { rows } = await pool.query<{ calls: number }>(
        `SELECT calls FROM feed_vk_call_months WHERE month = ${MONTH}`,
      );
      callsBefore = rows[0]?.calls ?? null;
    });

    beforeEach(async () => {
      logged.length = 0;
      vk.reset();
      vk.counter = app.get(VkCallMonthsRepository);
      await setCalls(0);
      for (const level of [
        "log",
        "warn",
        "error",
        "debug",
        "verbose",
      ] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            logged.push(
              args
                .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
                .join(" "),
            );
          },
        );
      }
    });

    afterEach(async () => {
      // EARS-51 — no log line carries a secret, an author field or a post text.
      const all = logged.join("\n");
      for (const s of Object.values(config)) expect(all).not.toContain(s);
      expect(all).not.toContain("777101");
      expect(all).not.toContain("777102");
      expect(all).not.toContain("Пост ");
      vi.restoreAllMocks();
      for (const id of sourceIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      if (pool) {
        if (callsBefore === null) {
          await pool.query(
            `DELETE FROM feed_vk_call_months WHERE month = ${MONTH}`,
          );
        } else {
          await setCalls(callsBefore);
        }
      }
      await app?.close();
    });

    it("048 EARS-46: the import shall write the earlier posts at their VK dates, skip a Callback-delivered post and a repost, and a re-run shall write nothing", async () => {
      const src = await source();
      const delivered = await callback(wallPost(src, 501), src.gid);
      expect(delivered.statusCode).toBe(200);
      const [held] = await entries(src.id);
      expect(held).toBeDefined();
      // Newest first, as `wall.get` answers.
      vk.walls.set(src.gid, [
        wallPost(src, 501, { text: "Пост 501 правлен" }),
        repost(src, 302),
        wallPost(src, 301),
        wallPost(src, 300),
      ]);

      const first = await importer.run({ source: `vk.com/${src.address}` });
      expect(first).toEqual({
        read: 4,
        written: 2,
        skippedExisting: 1,
        dropped: { repost: 1 },
        callsUsed: 1,
        stopped: null,
      });
      const rows = await entries(src.id);
      expect(rows.map((r) => [r.href, r.published_at.getTime()])).toEqual([
        [`https://vk.com/wall-${src.gid}_300`, (base + 300 * 60) * 1000],
        [`https://vk.com/wall-${src.gid}_301`, (base + 301 * 60) * 1000],
        [`https://vk.com/wall-${src.gid}_501`, held!.published_at.getTime()],
      ]);
      expect(rows[0]).toMatchObject({
        kind: "post",
        title: "Пост 300",
        image_url: "https://sun9-1.userapi.com/p300.jpg",
        source_off: false,
      });
      // The Callback-delivered post is not overwritten by the wall's edit.
      expect(rows[2]).toMatchObject({ id: held!.id, title: held!.title });
      expect(wallGets().map((c) => c.args[0])).toEqual([
        { owner_id: -src.gid, filter: "owner", count: 100, offset: 0 },
      ]);

      const again = await importer.run({ source: `vk.com/${src.address}` });
      expect(again).toMatchObject({ written: 0, skippedExisting: 3 });
      expect(await entries(src.id)).toEqual(rows);
    });

    it("048 EARS-46: the import shall page the whole wall by offset 100 and leave a hidden entry hidden and unchanged", async () => {
      const src = await source({ enabled: false });
      const wall = Array.from({ length: 205 }, (_, i) =>
        wallPost(src, 1000 - i),
      );
      vk.walls.set(src.gid, wall);
      await callback(wallPost(src, 1000), src.gid); // a switched-off source: dropped
      expect(await entries(src.id)).toEqual([]);

      const first = await importer.run({ source: src.address });
      expect(first).toMatchObject({ read: 205, written: 205, callsUsed: 3 });
      expect(
        wallGets().map((c) => (c.args[0] as { offset: number }).offset),
      ).toEqual([0, 100, 200]);
      const rows = await entries(src.id);
      expect(rows).toHaveLength(205);
      // EARS-41 — the switched-off source's entries are written switched off.
      expect(rows.every((r) => r.source_off)).toBe(true);

      const target = rows[10]!;
      await pool.query(
        "UPDATE feed_entries SET hidden_at = now() WHERE id = $1",
        [target.id],
      );
      const [hidden] = (await entries(src.id)).filter(
        (r) => r.id === target.id,
      );
      const again = await importer.run({ source: src.address });
      expect(again).toMatchObject({ written: 0, skippedExisting: 205 });
      const after = (await entries(src.id)).find((r) => r.id === target.id);
      expect(after).toEqual(hidden);
      expect(after!.hidden_at).not.toBeNull();
    }, 60_000);

    it("048 EARS-46: an unbound source shall be refused with its printed reason and nothing written or called", async () => {
      const src = await source({ bound: false });
      vk.walls.set(src.gid, [wallPost(src, 11)]);
      await expect(
        importer.run({ source: `vk.com/${src.address}` }),
      ).rejects.toEqual(
        new VkHistoryImportRefusedError(VK_UNBOUND_SOURCE_REASON),
      );
      expect(VK_UNBOUND_SOURCE_REASON).toBe(
        "the source has no bound VK community id; run the source check (EARS-44)",
      );
      expect(await entries(src.id)).toEqual([]);
      expect(vk.calls).toEqual([]);
    });

    it("048 EARS-46: an unlisted, a Telegram or a malformed source shall be refused with nothing called", async () => {
      await expect(
        importer.run({ source: "vk.com/nobody_listed_x" }),
      ).rejects.toBeInstanceOf(VkHistoryImportRefusedError);
      await expect(
        importer.run({ source: "https://t.me/x/1" }),
      ).rejects.toBeInstanceOf(VkHistoryImportRefusedError);
      expect(vk.calls).toEqual([]);
    });

    it("048 EARS-46: the import shall stop before the month's VK calls would pass 8 000, keeping what it wrote, and print the reason", async () => {
      const src = await source();
      vk.walls.set(
        src.gid,
        Array.from({ length: 150 }, (_, i) => wallPost(src, 2000 - i)),
      );
      await setCalls(7_999);
      const stopped = await importer.run({ source: src.address });
      expect(stopped).toMatchObject({
        read: 100,
        written: 100,
        callsUsed: 1,
        stopped: VK_CALL_BUDGET_REASON,
      });
      expect(wallGets()).toHaveLength(1);
      expect(await entries(src.id)).toHaveLength(100);

      // At the cap already: no call at all.
      vk.calls.length = 0;
      const none = await importer.run({ source: src.address });
      expect(none).toMatchObject({
        read: 0,
        written: 0,
        callsUsed: 0,
        stopped: VK_CALL_BUDGET_REASON,
      });
      expect(vk.calls).toEqual([]);

      // Next month (budget back): the re-run completes the wall.
      await setCalls(0);
      const rest = await importer.run({ source: src.address });
      expect(rest).toMatchObject({
        written: 50,
        skippedExisting: 100,
        stopped: null,
      });
    }, 60_000);
  },
);

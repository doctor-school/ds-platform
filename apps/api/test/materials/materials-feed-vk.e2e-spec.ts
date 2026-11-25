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
import { and, eq } from "drizzle-orm";
import { feedEntries, type DrizzleHandle } from "@ds/db";
import {
  DRIZZLE_DB,
  DRIZZLE_POOL,
} from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  FeedEntriesRepository,
  feedEntryRowVisible,
} from "../../src/materials/feed-entries.repository.js";
import { FakeVkApi } from "../../src/materials/vk/vk-api.fake.js";
import { VK_API } from "../../src/materials/vk/vk-api.types.js";
import { VK_CONFIG, type VkConfig } from "../../src/materials/vk/vk-config.js";
import {
  VK_SOURCE_CHECK_REASONS,
  vkAddressChangedReason,
  VkSourceCheck,
} from "../../src/materials/vk/vk-source-check.service.js";
import { VkWallReconcile } from "../../src/materials/vk/vk-wall-reconcile.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-25…V-28, V-31 (#4004) — the VK connector over the REAL stack (Fastify
// + Postgres) against the VK double: the Callback route (EARS-39, EARS-40),
// the post / video mapping and dedup (EARS-41…EARS-43), the source check
// (EARS-44), the hourly wall reconcile (EARS-45) and the secret / author-field
// hygiene of every log line, response and row (EARS-51). The scheduled jobs
// are driven through their units (`check`, `reconcile`) so this suite never
// touches rows of a parallel suite.
describe.skipIf(!process.env.DATABASE_URL)("048 VK connector (e2e)", () => {
  const config: VkConfig = {
    serviceKey: "vk1.a.E2E-service_key-value",
    callbackSecret: "e2e-callback-secret-7f3a",
    confirmation: "e2e-confirm-9b21",
  };
  const SECRETS = Object.values(config);
  const vk = new FakeVkApi();
  let app: NestFastifyApplication;
  let offApp: NestFastifyApplication;
  let pool: pg.Pool;
  let check: VkSourceCheck;
  let reconcile: VkWallReconcile;
  const sourceIds: string[] = [];
  const logged: string[] = [];
  const now = () => Math.floor(Date.now() / 1000);

  async function boot(cfg: VkConfig | null) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .overrideProvider(VK_CONFIG)
      .useValue(cfg)
      .overrideProvider(VK_API)
      .useValue(vk)
      .compile();
    const a = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
    return a;
  }

  const screenName = () =>
    `e2e_${Math.random().toString(36).slice(2, 10)}`.slice(0, 20);
  const groupId = () => 900_000_000 + Math.floor(Math.random() * 99_000_000);

  /** A listed VK source, bound unless `bound: false`; the double knows it. */
  async function source(
    opts: { enabled?: boolean; bound?: boolean; address?: string } = {},
  ) {
    const gid = groupId();
    const name = screenName();
    const address = opts.address ?? name;
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
    vk.groups.set(gid, { id: gid, screen_name: name });
    return { id: rows[0]!.id, address, gid, name };
  }
  type Src = Awaited<ReturnType<typeof source>>;

  const photo = (gid: number, width = 1080) => ({
    type: "photo",
    photo: {
      id: 1,
      owner_id: -gid,
      sizes: [
        { url: `https://sun9-1.userapi.com/s${width}.jpg`, width, height: 600 },
      ],
    },
  });
  const videoObj = (gid: number, id: number, over: object = {}) => ({
    id,
    owner_id: -gid,
    title: `Видео ${id}`,
    date: now() - 600,
    duration: 312,
    image: [{ url: `https://sun9-2.userapi.com/v${id}.jpg`, width: 800 }],
    type: "video",
    ...over,
  });
  const wallPost = (src: Src, id: number, over: object = {}) => ({
    id,
    owner_id: -src.gid,
    date: now() - 3 * 3600 + id,
    text: `Пост ${id}`,
    post_type: "post",
    created_by: 777_001,
    signer_id: 777_002,
    from_id: -src.gid,
    attachments: [photo(src.gid)],
    ...over,
  });

  function callback(body: unknown, target = app, raw = false) {
    return target.inject({
      method: "POST",
      url: "/v1/integrations/vk/callback",
      headers: { "content-type": "application/json", "x-retry-counter": "0" },
      payload: raw ? (body as string) : JSON.stringify(body),
    });
  }
  let eventSeq = 0;
  const event = (
    gid: number,
    type: string,
    object: unknown,
    over: object = {},
  ) => ({
    type,
    group_id: gid,
    event_id: `e2e${++eventSeq}${Math.random().toString(36).slice(2, 8)}`,
    v: "5.199",
    object,
    secret: config.callbackSecret,
    ...over,
  });

  async function entries(sourceId: string) {
    const { rows } = await pool.query<{
      id: string;
      kind: string;
      title: string;
      href: string;
      image_url: string | null;
      image_ref: string | null;
      duration_seconds: number | null;
      source_name: string;
      published_at: Date;
      hidden_at: Date | null;
      source_off: boolean;
      removed_at: Date | null;
      source_ref: string;
    }>(
      "SELECT * FROM feed_entries WHERE feed_source_id = $1 ORDER BY published_at, id",
      [sourceId],
    );
    return rows;
  }
  async function objects(sourceId: string) {
    const { rows } = await pool.query<{
      object_kind: string;
      vk_object_id: string;
      feed_entry_id: string;
    }>(
      "SELECT object_kind, vk_object_id::text, feed_entry_id FROM feed_entry_vk_objects WHERE feed_source_id = $1 ORDER BY object_kind, vk_object_id",
      [sourceId],
    );
    return rows;
  }
  async function sourceRow(id: string) {
    const { rows } = await pool.query<{
      status: string;
      status_reason: string | null;
      checked_at: Date | null;
      vk_group_id: string | null;
      vk_last_event_at: Date | null;
      version: number;
    }>("SELECT * FROM feed_sources WHERE id = $1", [id]);
    return rows[0]!;
  }
  const dropLines = () =>
    logged.filter((l) => l.includes('"event":"vk_event_dropped"'));

  beforeAll(async () => {
    app = await boot(config);
    offApp = await boot(null);
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
    check = app.get(VkSourceCheck);
    reconcile = app.get(VkWallReconcile);
  });

  beforeEach(() => {
    logged.length = 0;
    vk.reset();
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
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
    // EARS-51 — no log line carries a secret or an author field.
    const all = logged.join("\n");
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(all).not.toContain("777001");
    expect(all).not.toContain("777002");
    vi.restoreAllMocks();
    for (const id of sourceIds.splice(0)) {
      await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
        id,
      ]);
      await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
    }
  });

  afterAll(async () => {
    await offApp?.close();
    await app?.close();
  });

  // ── V-25: the Callback route (EARS-39, EARS-40) ─────────────────────

  it("048 EARS-39: when the VK connector is not configured, the Callback route shall answer 404 and change nothing", async () => {
    const src = await source();
    const res = await callback(
      event(src.gid, "wall_post_new", wallPost(src, 1)),
      offApp,
    );
    expect(res.statusCode).toBe(404);
    expect(await entries(src.id)).toEqual([]);
  });

  it("048 EARS-39: when the secret is wrong or missing, or the body does not parse, the system shall answer 401 and change nothing", async () => {
    const src = await source();
    const before = await sourceRow(src.id);
    const wrong = await callback(
      event(src.gid, "wall_post_new", wallPost(src, 1), { secret: "nope" }),
    );
    const missing = await callback(
      event(src.gid, "wall_post_new", wallPost(src, 2), { secret: undefined }),
    );
    const garbage = await callback("{not json", app, true);
    for (const res of [wrong, missing, garbage]) {
      expect(res.statusCode).toBe(401);
      expect(res.payload).toBe("");
    }
    expect(await entries(src.id)).toEqual([]);
    expect((await sourceRow(src.id)).vk_last_event_at).toEqual(
      before.vk_last_event_at,
    );
  });

  it("048 EARS-39: when a confirmation of a bound community arrives, the system shall answer the configured confirmation string; of an unlisted community, ok", async () => {
    const src = await source();
    const bound = await callback({ type: "confirmation", group_id: src.gid });
    expect(bound.statusCode).toBe(200);
    expect(bound.payload).toBe(config.confirmation);
    const withSecret = await callback({
      type: "confirmation",
      group_id: src.gid,
      secret: config.callbackSecret,
    });
    expect(withSecret.payload).toBe(config.confirmation);
    const unlisted = await callback({
      type: "confirmation",
      group_id: groupId(),
    });
    expect(unlisted.statusCode).toBe(200);
    expect(unlisted.payload).toBe("ok");
  });

  it("048 EARS-40: when an event of an unlisted, switched-off or unbound community, or of another type, arrives, the system shall answer ok, write nothing and log the drop with its reason", async () => {
    const on = await source();
    const off = await source({ enabled: false });
    const unbound = await source({ bound: false });
    const gid = groupId();
    const cases: Array<[unknown, string]> = [
      [
        event(gid, "wall_post_new", {
          id: 1,
          owner_id: -gid,
          date: now(),
          text: "x",
        }),
        "unlisted",
      ],
      [event(off.gid, "wall_post_new", wallPost(off, 1)), "source_off"],
      [event(unbound.gid, "wall_post_new", wallPost(unbound, 1)), "unlisted"],
      [event(on.gid, "wall_repost", wallPost(on, 2)), "other_event_type"],
      [
        event(
          on.gid,
          "wall_post_new",
          wallPost(on, 3, { copy_history: [{ id: 9 }] }),
        ),
        "repost",
      ],
      [
        event(
          on.gid,
          "wall_post_new",
          wallPost(on, 4, { post_type: "suggest" }),
        ),
        "not_published",
      ],
      [event(on.gid, "video_new", videoObj(on.gid, 5, { live: 1 })), "live"],
      [event(on.gid, "wall_post_new", { nonsense: true }), "malformed"],
    ];
    for (const [body, reason] of cases) {
      logged.length = 0;
      const res = await callback(body);
      expect(res.statusCode, reason).toBe(200);
      expect(res.payload).toBe("ok");
      const [line] = dropLines();
      expect(line, reason).toBeDefined();
      const parsed = JSON.parse(
        line!.slice(line!.indexOf("{"), line!.lastIndexOf("}") + 1),
      ) as Record<string, unknown>;
      expect(parsed.reason).toBe(reason);
      expect(Object.keys(parsed).sort()).toEqual(
        [
          "event",
          "eventId",
          "groupId",
          "objectId",
          "reason",
          "retryCounter",
          "type",
        ].sort(),
      );
    }
    for (const s of [on, off, unbound]) expect(await entries(s.id)).toEqual([]);
  });

  it("048 EARS-40: when the write fails, the system shall answer 500 with nothing written, so VK delivers again; the redelivery writes the post once", async () => {
    const src = await source();
    const repo = app.get(FeedEntriesRepository);
    const spy = vi
      .spyOn(repo, "attachVkObject")
      .mockRejectedValueOnce(new Error("db down"));
    const body = event(src.gid, "wall_post_new", wallPost(src, 11));
    const failed = await callback(body);
    expect(failed.statusCode).toBe(500);
    expect(await entries(src.id)).toEqual([]);
    spy.mockRestore();
    const again = await callback(body);
    expect(again.payload).toBe("ok");
    expect(await entries(src.id)).toHaveLength(1);
  });

  // ── V-26: mapping and dedup (EARS-41…EARS-43, EARS-51) ──────────────

  it("048 EARS-41: when a wall_post_new of a listed community arrives, the system shall write one post entry with text, date, the referenced VK preview and the permalink, and record the event time", async () => {
    const src = await source();
    const before = await sourceRow(src.id);
    const p = wallPost(src, 21);
    const res = await callback(event(src.gid, "wall_post_new", p));
    expect(res.payload).toBe("ok");
    const [row] = await entries(src.id);
    expect(row).toMatchObject({
      kind: "post",
      title: "Пост 21",
      href: `https://vk.com/wall-${src.gid}_21`,
      image_url: "https://sun9-1.userapi.com/s1080.jpg",
      image_ref: null,
      duration_seconds: null,
      source_name: "BBM Academy · VK",
      source_off: false,
      removed_at: null,
    });
    expect(row!.published_at.getTime()).toBe(p.date * 1000);
    const after = await sourceRow(src.id);
    expect(after.vk_last_event_at!.getTime()).toBeGreaterThan(
      before.vk_last_event_at!.getTime(),
    );
  });

  it("048 EARS-42: when a video_new of a listed community arrives, the system shall write one video entry with title, date, cover, duration and the video permalink", async () => {
    const src = await source();
    await callback(event(src.gid, "video_new", videoObj(src.gid, 31)));
    const [row] = await entries(src.id);
    expect(row).toMatchObject({
      kind: "video",
      title: "Видео 31",
      href: `https://vk.com/video-${src.gid}_31`,
      image_url: "https://sun9-2.userapi.com/v31.jpg",
      duration_seconds: 312,
      source_name: "BBM Academy · VK Видео",
    });
  });

  it("048 EARS-43: when the same post arrives twice, or a video arrives before or after the post that attaches it, the system shall hold one entry per publication", async () => {
    const src = await source();
    // Same post twice (VK retry).
    const p1 = event(src.gid, "wall_post_new", wallPost(src, 41));
    await callback(p1);
    await callback({ ...p1, event_id: "retry" });
    // Video first, then the post attaching it: the post absorbs the video.
    await callback(event(src.gid, "video_new", videoObj(src.gid, 501)));
    const withVideo = (id: number, vid: number) =>
      wallPost(src, id, {
        attachments: [{ type: "video", video: videoObj(src.gid, vid) }],
      });
    await callback(event(src.gid, "wall_post_new", withVideo(42, 501)));
    // Post first, then the video_new of its video: nothing new.
    await callback(event(src.gid, "wall_post_new", withVideo(43, 502)));
    await callback(event(src.gid, "video_new", videoObj(src.gid, 502)));
    const rows = await entries(src.id);
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ["post", "Пост 41"],
      ["post", "Пост 42"],
      ["post", "Пост 43"],
    ]);
    const post42 = rows.find((r) => r.title === "Пост 42")!;
    expect(post42.duration_seconds).toBe(312);
    const keys = await objects(src.id);
    expect(keys.filter((k) => k.object_kind === "video")).toEqual([
      expect.objectContaining({
        vk_object_id: "501",
        feed_entry_id: post42.id,
      }),
      expect.objectContaining({ vk_object_id: "502" }),
    ]);
  });

  it("048 EARS-43: when the post that attaches a hidden video entry arrives, the post entry shall take the video entry's hidden mark, the video entry go and the feed not show it; a post with its own mark keeps it", async () => {
    const src = await source();
    const withVideo = (id: number, vid: number, over: object = {}) =>
      wallPost(src, id, {
        attachments: [{ type: "video", video: videoObj(src.gid, vid) }],
        ...over,
      });
    const hide = (id: string, at: string) =>
      pool.query("UPDATE feed_entries SET hidden_at = $2 WHERE id = $1", [
        id,
        at,
      ]);
    const db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
    const visible = async () =>
      (
        await db
          .select({ id: feedEntries.id })
          .from(feedEntries)
          .where(and(eq(feedEntries.feedSourceId, src.id), feedEntryRowVisible))
      ).map((r) => r.id);
    // The video first, hidden by the administrator; then its post (Callback).
    await callback(event(src.gid, "video_new", videoObj(src.gid, 601)));
    const [video] = await entries(src.id);
    await hide(video!.id, "2026-11-01T10:00:00Z");
    await callback(event(src.gid, "wall_post_new", withVideo(61, 601)));
    let rows = await entries(src.id);
    expect(rows.map((r) => r.kind)).toEqual(["post"]);
    const post61 = rows[0]!;
    expect(post61.hidden_at).toEqual(new Date("2026-11-01T10:00:00Z"));
    expect(rows.find((r) => r.id === video!.id)).toBeUndefined();
    expect(await visible()).toEqual([]);
    // A held post with its own hide is edited to attach a hidden video
    // (reconcile): it keeps its own mark and absorbs the video entry.
    await callback(event(src.gid, "wall_post_new", wallPost(src, 62)));
    await callback(event(src.gid, "video_new", videoObj(src.gid, 602)));
    rows = await entries(src.id);
    const post62 = rows.find((r) => r.title === "Пост 62")!;
    const video602 = rows.find((r) => r.kind === "video")!;
    await hide(post62.id, "2026-11-02T10:00:00Z");
    await hide(video602.id, "2026-11-03T10:00:00Z");
    vk.walls.set(src.gid, [withVideo(62, 602), withVideo(61, 601)]);
    await reconcile.reconcile(src.id);
    rows = await entries(src.id);
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ["post", "Пост 61"],
      ["post", "Пост 62"],
    ]);
    expect(rows.find((r) => r.id === post62.id)!.hidden_at).toEqual(
      new Date("2026-11-02T10:00:00Z"),
    );
    expect(await visible()).toEqual([]);
  });

  it("048 EARS-51: the stored rows carry no secret, raw event or author field", async () => {
    const src = await source();
    await callback(event(src.gid, "wall_post_new", wallPost(src, 51)));
    const { rows } = await pool.query(
      "SELECT to_jsonb(e)::text AS j FROM feed_entries e WHERE feed_source_id = $1",
      [src.id],
    );
    const { rows: srcRows } = await pool.query(
      "SELECT to_jsonb(s)::text AS j FROM feed_sources s WHERE id = $1",
      [src.id],
    );
    const stored = [...rows, ...srcRows]
      .map((r: { j: string }) => r.j)
      .join("\n");
    for (const s of SECRETS) expect(stored).not.toContain(s);
    expect(stored).not.toContain("777001");
    expect(stored).not.toContain("777002");
    expect(stored).not.toContain("wall_post_new");
  });

  // ── V-27: the source check (EARS-44) ────────────────────────────────

  it("048 EARS-44: while unbound, the check shall bind the community whose screen name equals the address, or whose id club<id> names, with the binding time as the last event, and set «Работает»", async () => {
    const byName = await source({ bound: false });
    const row = await check.check(byName.id);
    expect(row).toMatchObject({
      status: "ok",
      statusReason: null,
      vkGroupId: byName.gid,
    });
    expect(row!.vkLastEventAt).not.toBeNull();
    expect(row!.checkedAt).not.toBeNull();

    const gid = groupId();
    const club = await source({ bound: false, address: `club${gid}` });
    vk.groups.set(gid, { id: gid, screen_name: `club${gid}` });
    expect(await check.check(club.id)).toMatchObject({
      status: "ok",
      vkGroupId: gid,
    });
    // Only groups.getById reached VK.
    expect(new Set(vk.calls.map((c) => c.method))).toEqual(
      new Set(["groups.getById"]),
    );
  });

  it("048 EARS-44: the check shall set «Ошибка» with each failing reason of the table", async () => {
    const off = await source({ bound: false });
    expect(await offApp.get(VkSourceCheck).check(off.id)).toMatchObject({
      status: "failing",
      statusReason: VK_SOURCE_CHECK_REASONS.notConfigured,
    });

    const gone = await source();
    vk.groups.delete(gone.gid);
    expect(await check.check(gone.id)).toMatchObject({
      statusReason: VK_SOURCE_CHECK_REASONS.communityNotFound,
    });
    const deactivated = await source();
    vk.groups.set(deactivated.gid, {
      id: deactivated.gid,
      deactivated: "banned",
    });
    expect(await check.check(deactivated.id)).toMatchObject({
      statusReason: VK_SOURCE_CHECK_REASONS.communityNotFound,
    });

    // A bound community answering another screen name: reported, and the
    // bound id is neither overwritten nor dropped.
    const renamed = await source();
    vk.groups.set(renamed.gid, {
      id: renamed.gid,
      screen_name: "e2e_renamed_x",
    });
    const r = await check.check(renamed.id);
    expect(r).toMatchObject({
      status: "failing",
      statusReason: vkAddressChangedReason("e2e_renamed_x"),
      vkGroupId: renamed.gid,
    });

    const unreachable = await source();
    vk.outage = "timeout";
    expect(await check.check(unreachable.id)).toMatchObject({
      statusReason: VK_SOURCE_CHECK_REASONS.unreachable,
    });
    vk.outage = null;

    vk.apiErrorCode = 5;
    const badKey = await source();
    expect(await check.check(badKey.id)).toMatchObject({
      statusReason: VK_SOURCE_CHECK_REASONS.notConfigured,
    });
    vk.apiErrorCode = null;
  });

  it("048 EARS-44: when the last reconcile wrote a post newer than the last Callback event and older than one hour, the check shall set «VK не присылает новые записи»", async () => {
    const src = await source();
    await pool.query(
      "UPDATE feed_sources SET vk_last_event_at = now() - interval '5 hours' WHERE id = $1",
      [src.id],
    );
    vk.walls.set(src.gid, [
      wallPost(src, 61, { date: now() - 2 * 3600 }),
      wallPost(src, 60, { date: now() - 6 * 3600 }),
    ]);
    await reconcile.reconcile(src.id);
    expect(await check.check(src.id)).toMatchObject({
      status: "failing",
      statusReason: VK_SOURCE_CHECK_REASONS.noEvents,
    });
    // A Callback event after that post clears it.
    await callback(event(src.gid, "wall_post_new", wallPost(src, 62)));
    expect(await check.check(src.id)).toMatchObject({ status: "ok" });
  });

  it("048 EARS-44: when the month's VK calls reach 8 000, the check shall set «Лимит вызовов VK почти исчерпан»", async () => {
    const src = await source();
    const month =
      "date_trunc('month', now() AT TIME ZONE 'Europe/Moscow')::date";
    const { rows } = await pool.query<{ calls: number }>(
      `SELECT calls FROM feed_vk_call_months WHERE month = ${month}`,
    );
    const was = rows[0]?.calls ?? null;
    try {
      await pool.query(
        `INSERT INTO feed_vk_call_months (month, calls) VALUES (${month}, 8000)
             ON CONFLICT (month) DO UPDATE SET calls = 8000`,
      );
      expect(await check.check(src.id)).toMatchObject({
        status: "failing",
        statusReason: VK_SOURCE_CHECK_REASONS.callBudget,
      });
    } finally {
      if (was === null) {
        await pool.query(
          `DELETE FROM feed_vk_call_months WHERE month = ${month}`,
        );
      } else {
        await pool.query(
          `UPDATE feed_vk_call_months SET calls = $1 WHERE month = ${month}`,
          [was],
        );
      }
    }
  });

  // ── V-28: the wall reconcile (EARS-45) ──────────────────────────────

  it("048 EARS-45: the reconcile shall rewrite an edited post in place keeping its date, hide and switched-off mark, insert a missed post and change no video entry", async () => {
    const src = await source();
    await callback(event(src.gid, "wall_post_new", wallPost(src, 71)));
    await callback(event(src.gid, "video_new", videoObj(src.gid, 701)));
    const [held] = await entries(src.id);
    await pool.query(
      "UPDATE feed_entries SET hidden_at = now() WHERE id = $1",
      [held!.id],
    );
    const before = (await entries(src.id)).find((r) => r.id === held!.id)!;
    vk.walls.set(src.gid, [
      wallPost(src, 72),
      wallPost(src, 71, {
        text: "Пост 71 исправлен",
        attachments: [photo(src.gid, 640)],
      }),
    ]);
    const outcome = await reconcile.reconcile(src.id);
    expect(outcome).toMatchObject({ written: 1, updated: 1, removed: 0 });
    const rows = await entries(src.id);
    const edited = rows.find((r) => r.id === held!.id)!;
    expect(edited.title).toBe("Пост 71 исправлен");
    expect(edited.image_url).toBe("https://sun9-1.userapi.com/s640.jpg");
    expect(edited.published_at).toEqual(before.published_at);
    expect(edited.hidden_at).toEqual(before.hidden_at);
    expect(rows.filter((r) => r.kind === "post").map((r) => r.title)).toContain(
      "Пост 72",
    );
    const video = rows.find((r) => r.kind === "video")!;
    expect(video.removed_at).toBeNull();
    // Re-run: nothing duplicated.
    await reconcile.reconcile(src.id);
    expect(await entries(src.id)).toHaveLength(3);
    expect(vk.calls.every((c) => c.method === "wall.get")).toBe(true);
  });

  it("048 EARS-45: the reconcile shall mark removed a held post inside the span of the returned non-pinned posts and absent from them, leave one before the span, and clear the mark when the post returns", async () => {
    const src = await source();
    const t = now() - 10 * 3600;
    const at = (h: number) => ({ date: t + h * 3600 });
    for (const [id, h] of [
      [81, 1],
      [82, 2],
      [83, 3],
    ] as const) {
      await callback(event(src.gid, "wall_post_new", wallPost(src, id, at(h))));
    }
    // A full page (100) whose oldest non-pinned post is 82: 81 is before
    // the span; 83 is inside it and missing. The pinned old post 80 does
    // not widen the span.
    const filler = Array.from({ length: 97 }, (_, i) =>
      wallPost(src, 1000 + i, at(5 + i / 100)),
    );
    vk.walls.set(src.gid, [
      wallPost(src, 80, { ...at(0), is_pinned: 1 }),
      ...filler,
      wallPost(src, 82, at(2)),
      { id: 999_999, owner_id: -src.gid, broken: true },
    ]);
    await reconcile.reconcile(src.id);
    const byTitle = async () =>
      new Map((await entries(src.id)).map((r) => [r.title, r]));
    let rows = await byTitle();
    expect(rows.get("Пост 83")!.removed_at).not.toBeNull();
    expect(rows.get("Пост 81")!.removed_at).toBeNull();
    expect(rows.get("Пост 82")!.removed_at).toBeNull();
    // The post is back on the wall: the mark clears.
    vk.walls.set(src.gid, [wallPost(src, 83, at(3)), wallPost(src, 82, at(2))]);
    await reconcile.reconcile(src.id);
    rows = await byTitle();
    expect(rows.get("Пост 83")!.removed_at).toBeNull();
    // Below a full page the whole wall is the span: 81 is now absent.
    expect(rows.get("Пост 81")!.removed_at).not.toBeNull();
  });

  it("048 EARS-45: when VK is unreachable or answers an error, the reconcile shall change no entry", async () => {
    const src = await source();
    await callback(event(src.gid, "wall_post_new", wallPost(src, 91)));
    const before = await entries(src.id);
    vk.outage = "network_error";
    expect(await reconcile.reconcile(src.id)).toBeUndefined();
    vk.outage = null;
    vk.apiErrorCode = 15;
    expect(await reconcile.reconcile(src.id)).toBeUndefined();
    vk.apiErrorCode = null;
    expect(await entries(src.id)).toEqual(before);
    // Unbound or switched off: not read at all.
    const unbound = await source({ bound: false });
    const off = await source({ enabled: false });
    vk.calls.length = 0;
    expect(await reconcile.reconcile(unbound.id)).toBeUndefined();
    expect(await reconcile.reconcile(off.id)).toBeUndefined();
    expect(vk.calls).toEqual([]);
  });
});

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
import { FeedEntriesRepository } from "../../src/materials/feed-entries.repository.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import {
  TELEGRAM_BOT_API,
  type RawUpdate,
} from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  type TelegramConfig,
} from "../../src/materials/telegram/telegram-config.js";
import { TelegramUpdateCursorRepository } from "../../src/materials/telegram/telegram-update-cursor.repository.js";
import {
  TELEGRAM_POLL_HTTP_TIMEOUT_MS,
  TELEGRAM_POLL_TIMEOUT_S,
  TelegramUpdatePoller,
  telegramPollBackoffMs,
} from "../../src/materials/telegram/telegram-update-poller.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-15 (#3994, #4165) — Telegram ingress by long polling over the REAL
// stack (Nest + Postgres) against the Telegram double: the poller deletes any
// webhook, long-polls `getUpdates` from the stored offset, advances it only
// past a processed or dropped update, retries a lost call, polls in one
// process at a time and runs not at all without a token (EARS-24); matching,
// drops, idempotent refetch and no offset move on our own failure (EARS-25);
// the mapping (EARS-26), albums (EARS-27), edits (EARS-28) and the EARS-36
// hygiene of every log line and stored row. The double holds no file here,
// so each preview copy attempt (EARS-29, `telegram-preview-check.e2e-spec.ts`)
// fails, is counted and leaves the card imageless. Each app's own polling
// loop is stopped after boot, so a test drives one poll at a time.
describe.skipIf(!process.env.DATABASE_URL)("048 Telegram update poller (e2e)", () => {
  const TOKEN = "123456:E2E-bot_token-value";
  const SIGNATURE = "Иван Подписантов";
  const config: TelegramConfig = { botToken: TOKEN };
  const telegram = new FakeTelegramBotApi();
  let app: NestFastifyApplication;
  let offApp: NestFastifyApplication;
  let pool: pg.Pool;
  const sourceIds: string[] = [];
  const logged: string[] = [];
  let updateSeq = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  const base = Math.floor(Date.now() / 1000) - 3600;

  async function boot(cfg: TelegramConfig | null) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .overrideProvider(TELEGRAM_CONFIG)
      .useValue(cfg)
      .overrideProvider(TELEGRAM_BOT_API)
      .useValue(telegram)
      .compile();
    const a = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
    // The test drives each poll itself.
    await a.get(TelegramUpdatePoller).stop();
    return a;
  }

  /** A fresh valid channel username and a negative channel id. */
  const username = () =>
    `c${Math.random().toString(36).slice(2, 8)}${Math.random()
      .toString(36)
      .slice(2, 7)}`.padEnd(12, "x");
  const chatId = () => -1_000_000_000_000 - Math.floor(Math.random() * 1e9);

  async function source(opts: { enabled?: boolean } = {}) {
    const address = username();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO feed_sources (platform, address, enabled)
         VALUES ('telegram', $1, $2) RETURNING id`,
      [address, opts.enabled ?? true],
    );
    sourceIds.push(rows[0]!.id);
    return { id: rows[0]!.id, address, chatId: chatId() };
  }
  type Src = Awaited<ReturnType<typeof source>>;

  function message(
    src: Src,
    messageId: number,
    extra: Record<string, unknown> = {},
  ) {
    return {
      message_id: messageId,
      date: base + messageId,
      chat: {
        id: src.chatId,
        type: "channel",
        username: src.address,
        title: "BBM Academy",
      },
      sender_chat: { id: src.chatId, type: "channel" },
      author_signature: SIGNATURE,
      ...extra,
    };
  }

  const photo = (id: string, widths = [90, 800, 1280, 2560]) =>
    widths.map((w) => ({
      file_id: `${id}-${w}`,
      file_unique_id: `u-${id}-${w}`,
      width: w,
      height: w,
    }));

  const poller = (target?: NestFastifyApplication) =>
    (target ?? app).get(TelegramUpdatePoller);

  /** Telegram receives the update; then one poll of `target` runs. */
  function deliver(
    body: unknown,
    opts: { target?: NestFastifyApplication } = {},
  ) {
    telegram.push(body as RawUpdate);
    return poller(opts.target).pollOnce();
  }

  async function storedOffset(): Promise<number | null> {
    const { rows } = await pool.query<{ next_offset: string }>(
      "SELECT next_offset FROM telegram_update_cursor WHERE bot_id = $1",
      [telegram.me.id],
    );
    return rows[0] ? Number(rows[0].next_offset) : null;
  }

  const post = (msg: unknown) => ({
    update_id: ++updateSeq,
    channel_post: msg,
  });
  const edit = (msg: unknown) => ({
    update_id: ++updateSeq,
    edited_channel_post: msg,
  });

  interface EntryRow {
    id: string;
    kind: string;
    source_platform: string;
    source_ref: string;
    title: string;
    href: string;
    published_at: Date;
    source_name: string;
    partner_organisation_id: string | null;
    image_ref: string | null;
    image_url: string | null;
    media_group_id: string | null;
    duration_seconds: number | null;
    preview_file_id: string | null;
    preview_file_unique_id: string | null;
    preview_state: string | null;
    preview_attempts: number;
    hidden_at: Date | null;
    updated_at: Date;
  }

  async function entries(src: Src): Promise<EntryRow[]> {
    const { rows } = await pool.query<EntryRow>(
      "SELECT * FROM feed_entries WHERE feed_source_id = $1 ORDER BY source_ref",
      [src.id],
    );
    return rows;
  }

  async function messageIds(entryId: string): Promise<number[]> {
    const { rows } = await pool.query<{ message_id: string }>(
      "SELECT message_id FROM feed_entry_messages WHERE feed_entry_id = $1 ORDER BY message_id",
      [entryId],
    );
    return rows.map((r) => Number(r.message_id));
  }

  async function boundId(src: Src): Promise<string | null> {
    const { rows } = await pool.query<{ telegram_chat_id: string | null }>(
      "SELECT telegram_chat_id FROM feed_sources WHERE id = $1",
      [src.id],
    );
    return rows[0]!.telegram_chat_id;
  }

  /** The drop lines of the log, parsed. */
  const drops = () =>
    logged
      .filter((l) => l.includes("telegram_update_dropped"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    app = await boot(config);
    offApp = await boot(null);
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
  });

  beforeEach(() => {
    logged.length = 0;
    telegram.reset();
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
    // EARS-36 — no log line of any test carries a secret, the author or a payload.
    const all = logged.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(SIGNATURE);
    // Ingress calls only the poll's own methods and the preview copy (EARS-29).
    expect(
      telegram.calls.filter(
        (c) =>
          ![
            "getMe",
            "deleteWebhook",
            "getUpdates",
            "getFile",
            "downloadFile",
          ].includes(c.method),
      ),
    ).toEqual([]);
    vi.restoreAllMocks();
    for (const id of sourceIds.splice(0)) {
      await pool.query(
        "DELETE FROM feed_entry_messages WHERE feed_source_id = $1",
        [id],
      );
      await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
        id,
      ]);
      await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
    }
  });

  afterAll(async () => {
    await pool
      ?.query("DELETE FROM telegram_update_cursor WHERE bot_id = $1", [
        telegram.me.id,
      ])
      .catch(() => undefined);
    await offApp?.close();
    await app?.close();
  });

  // ── EARS-24: the poller ─────────────────────────────────────────

  it("048 EARS-24: while the token is configured, the system shall delete any webhook keeping its updates, long-poll getUpdates for channel posts and edits from the stored offset, and advance the offset past each processed update", async () => {
    const src = await source();
    telegram.webhookUrl = "https://old.example.test/hook";
    const first = post(message(src, 1101, { text: "Первый" }));
    const second = post(message(src, 1102, { text: "Второй" }));
    telegram.push(first, second);
    // A process's first poll clears the webhook before it asks for updates.
    await poller().stop();
    expect(await poller().pollOnce()).toEqual({ kind: "polled", processed: 2 });
    expect(telegram.calls.map((c) => c.method)).toEqual([
      "getMe",
      "deleteWebhook",
      "getUpdates",
    ]);
    expect(telegram.webhookUrl).toBe("");
    expect(telegram.calls[2]!.args[0]).toEqual({
      offset: expect.any(Number),
      limit: 100,
      timeout: TELEGRAM_POLL_TIMEOUT_S,
      allowed_updates: ["channel_post", "edited_channel_post"],
    });
    expect(TELEGRAM_POLL_HTTP_TIMEOUT_MS).toBeGreaterThan(
      TELEGRAM_POLL_TIMEOUT_S * 1000,
    );
    expect(await storedOffset()).toBe(second.update_id + 1);
    expect((await entries(src)).map((e) => e.title)).toEqual([
      "Первый",
      "Второй",
    ]);
    // The next poll asks from the stored offset, which confirms both.
    const third = post(message(src, 1103, { text: "Третий" }));
    expect(await deliver(third)).toEqual({ kind: "polled", processed: 1 });
    const polls = telegram.calls.filter((c) => c.method === "getUpdates");
    expect(polls.at(-1)!.args[0]).toMatchObject({
      offset: second.update_id + 1,
    });
    expect(
      telegram.calls.filter((c) => c.method === "deleteWebhook"),
    ).toHaveLength(1);
    expect(await storedOffset()).toBe(third.update_id + 1);
    const { rows } = await pool.query<{ polled_at: Date | null }>(
      "SELECT polled_at FROM telegram_update_cursor WHERE bot_id = $1",
      [telegram.me.id],
    );
    expect(Date.now() - rows[0]!.polled_at!.getTime()).toBeLessThan(60_000);
  });

  it("048 EARS-24: when getUpdates answers 409 because a webhook is set, the system shall delete the webhook and poll again without losing an update", async () => {
    const src = await source();
    await deliver(post(message(src, 1110, { text: "До" })));
    telegram.webhookUrl = "https://someone.example.test/hook";
    const held = post(message(src, 1111, { text: "Во время вебхука" }));
    expect(await deliver(held)).toEqual({
      kind: "failed",
      stage: "telegram",
      processed: 0,
    });
    expect(telegram.calls.at(-1)!.method).toBe("deleteWebhook");
    expect(telegram.webhookUrl).toBe("");
    expect(await poller().pollOnce()).toEqual({ kind: "polled", processed: 1 });
    expect((await entries(src)).map((e) => e.title)).toEqual([
      "До",
      "Во время вебхука",
    ]);
  });

  it("048 EARS-24: when a call fails or times out, the system shall retry it after a capped backoff from the same offset, losing nothing", async () => {
    const src = await source();
    await deliver(post(message(src, 1120, { text: "До" })));
    const offset = await storedOffset();
    telegram.outage = "timeout";
    const lost = post(message(src, 1121, { text: "После таймаута" }));
    expect(await deliver(lost)).toEqual({
      kind: "failed",
      stage: "telegram",
      processed: 0,
    });
    expect(await storedOffset()).toBe(offset);
    telegram.outage = null;
    expect(await poller().pollOnce()).toEqual({ kind: "polled", processed: 1 });
    expect(await storedOffset()).toBe(lost.update_id + 1);
    expect(await entries(src)).toHaveLength(2);
    expect([1, 2, 3, 6, 7, 20].map((n) => telegramPollBackoffMs(n))).toEqual([
      1000, 2000, 4000, 32_000, 60_000, 60_000,
    ]);
  });

  it("048 EARS-24: while one API instance polls, another shall call nothing", async () => {
    const second = await boot(config);
    try {
      const src = await source();
      await deliver(post(message(src, 1130, { text: "Первый процесс" })));
      telegram.calls.length = 0;
      expect(
        await deliver(post(message(src, 1131, { text: "Второй процесс" })), {
          target: second,
        }),
      ).toEqual({ kind: "not_leader" });
      expect(telegram.calls).toEqual([]);
      // The first process releases the lock: the second takes over.
      await poller().stop();
      expect(await poller(second).pollOnce()).toEqual({
        kind: "polled",
        processed: 1,
      });
      await poller(second).stop();
    } finally {
      await second.close();
    }
  });

  it("048 EARS-24: while the bot token is not configured, the system shall run no poller and call nothing", async () => {
    const src = await source();
    expect(poller(offApp).running).toBe(false);
    expect(
      await deliver(post(message(src, 1201, { text: "Пост" })), {
        target: offApp,
      }),
    ).toEqual({ kind: "off" });
    expect(telegram.calls).toEqual([]);
    expect(await entries(src)).toEqual([]);
  });

  // ── EARS-25: matching, drops, idempotency, our own failure ──────────

  it("048 EARS-25: when an update's channel is unlisted, switched off, of another type or malformed, the system shall drop it, advance past it and log its ids and reason only", async () => {
    const off = await source({ enabled: false });
    const stranger: Src = {
      id: "-",
      address: "somebodyelse",
      chatId: chatId(),
    };
    const cases: Array<[unknown, string]> = [
      [post(message(stranger, 77, { text: "Чужой" })), "unlisted"],
      [post(message(off, 78, { text: "Выключен" })), "source_off"],
      [
        { update_id: ++updateSeq, message: message(off, 79, { text: "ЛС" }) },
        "other_update_type",
      ],
      [
        { update_id: ++updateSeq, channel_post: { text: "нет id" } },
        "malformed",
      ],
    ];
    for (const [body, reason] of cases) {
      expect(await deliver(body)).toEqual({ kind: "polled", processed: 1 });
      expect(drops().at(-1)?.reason).toBe(reason);
    }
    for (const line of drops()) {
      expect(Object.keys(line).sort()).toEqual(
        ["chatId", "event", "messageId", "reason", "updateId"].sort(),
      );
    }
    expect(await storedOffset()).toBe(updateSeq + 1);
    expect(drops()[0]).toMatchObject({
      chatId: stranger.chatId,
      messageId: 77,
    });
    expect(JSON.stringify(drops())).not.toMatch(/Чужой|Выключен/);
    expect(await entries(off)).toEqual([]);
    const { rows } = await pool.query(
      "SELECT 1 FROM feed_entries WHERE href LIKE 'https://t.me/somebodyelse/%'",
    );
    expect(rows).toEqual([]);
  });

  it("048 EARS-25: when a listed channel first posts, the system shall match it by username and bind its id; from then on the id decides", async () => {
    const src = await source();
    expect(
      (await deliver(post(message(src, 10, { text: "Первый" })))).kind,
    ).toBe("polled");
    expect(await boundId(src)).toBe(String(src.chatId));
    // A rename keeps delivering by the bound id.
    const renamed = message(src, 11, { text: "После переименования" });
    renamed.chat.username = "renamedchannel";
    expect((await deliver(post(renamed))).kind).toBe("polled");
    expect((await entries(src)).map((e) => e.title)).toEqual([
      "Первый",
      "После переименования",
    ]);
    // Another channel claiming the bound source's username does not match.
    const impostor = message({ ...src, chatId: chatId() }, 12, {
      text: "Самозванец",
    });
    await deliver(post(impostor));
    expect(drops().at(-1)?.reason).toBe("unlisted");
    expect(await entries(src)).toHaveLength(2);
  });

  it("048 EARS-25: when a post already processed is fetched again, the system shall change nothing", async () => {
    const src = await source();
    const body = post(message(src, 20, { text: "Один раз" }));
    // Written, but the offset write fails: the next poll fetches it again.
    vi.spyOn(
      TelegramUpdateCursorRepository.prototype,
      "advance",
    ).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    expect(await deliver(body)).toEqual({
      kind: "failed",
      stage: "processing",
      processed: 0,
    });
    const [before] = await entries(src);
    expect(before).toBeDefined();
    expect(await poller().pollOnce()).toEqual({ kind: "polled", processed: 1 });
    expect(await storedOffset()).toBe(body.update_id + 1);
    // The same post under a new update id changes nothing either.
    expect(
      (await deliver(post(message(src, 20, { text: "Один раз" })))).kind,
    ).toBe("polled");
    const after = await entries(src);
    expect(after).toHaveLength(1);
    expect(after[0]!.updated_at).toEqual(before!.updated_at);
    expect(await messageIds(before!.id)).toEqual([20]);
  });

  it("048 EARS-25: when processing fails on our side, the system shall not advance the offset and write nothing partial, so the update is fetched again", async () => {
    const src = await source();
    await deliver(post(message(src, 29, { text: "До сбоя" })));
    const offset = await storedOffset();
    vi.spyOn(
      FeedEntriesRepository.prototype,
      "attachTelegramMessage",
    ).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    const failing = post(message(src, 30, { text: "Сбой" }));
    const later = post(message(src, 31, { text: "После" }));
    telegram.push(failing);
    expect(await deliver(later)).toEqual({
      kind: "failed",
      stage: "processing",
      processed: 0,
    });
    expect(await storedOffset()).toBe(offset);
    expect((await entries(src)).map((e) => e.title)).toEqual(["До сбоя"]);
    expect(logged.join("\n")).not.toContain("Сбой");
    expect(logged.some((l) => l.includes("telegram_update_failed"))).toBe(
      true,
    );
    // The next poll fetches both again, in order, and each lands once.
    expect(await poller().pollOnce()).toEqual({ kind: "polled", processed: 2 });
    expect((await entries(src)).map((e) => e.title)).toEqual([
      "До сбоя",
      "Сбой",
      "После",
    ]);
    expect(await storedOffset()).toBe(later.update_id + 1);
  });

  // ── EARS-26: the mapping ─────────────────────────────────────────────

  it("048 EARS-26: when a processed post is a text, a photo or a video, the system shall write one post entry with its plain text, date, preview, duration and permalink and no partner", async () => {
    const src = await source();
    const long = Array.from({ length: 150 }, (_, i) => `слово${i}`).join(" ");
    await deliver(
      post(
        message(src, 1200, {
          text: `  ${long}  `,
          entities: [{ type: "bold", offset: 0, length: 5 }],
        }),
      ),
    );
    await deliver(
      post(
        message(src, 1201, {
          caption: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
          photo: photo("p1201"),
        }),
      ),
    );
    await deliver(
      post(
        message(src, 1202, {
          caption: "PRP при гонартрозе — фрагмент эфира",
          video: {
            file_id: "video-1202",
            file_unique_id: "u-video-1202",
            width: 1280,
            height: 720,
            duration: 72,
            thumbnail: {
              file_id: "thumb-1202",
              file_unique_id: "u-thumb-1202",
              width: 320,
              height: 180,
            },
          },
        }),
      ),
    );
    const [text, pic, video] = await entries(src);
    for (const e of [text!, pic!, video!]) {
      expect(e).toMatchObject({
        kind: "post",
        source_platform: "telegram",
        source_name: "BBM Academy · Telegram",
        partner_organisation_id: null,
        image_ref: null,
        image_url: null,
        hidden_at: null,
      });
    }
    expect(text!.title.endsWith("…")).toBe(true);
    expect([...text!.title].length).toBeLessThanOrEqual(501);
    expect(long.startsWith(text!.title.slice(0, -1))).toBe(true);
    expect(text).toMatchObject({
      href: `https://t.me/${src.address}/1200`,
      source_ref: `${src.id}:1200`,
      preview_state: null,
      preview_file_id: null,
      duration_seconds: null,
    });
    expect(text!.published_at.getTime()).toBe((base + 1200) * 1000);
    expect(pic).toMatchObject({
      title: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
      href: `https://t.me/${src.address}/1201`,
      preview_state: "pending",
      preview_file_id: "p1201-1280",
      preview_file_unique_id: "u-p1201-1280",
    });
    expect(video).toMatchObject({
      title: "PRP при гонартрозе — фрагмент эфира",
      duration_seconds: 72,
      preview_state: "pending",
      preview_file_id: "thumb-1202",
    });
  });

  it("048 EARS-26: when a post is a forward, other content, a service message or has neither text nor image, the system shall drop and log it, writing nothing", async () => {
    const src = await source();
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { text: "Репост", forward_origin: { type: "channel", date: base } },
        "forward",
      ],
      [
        { poll: { id: "p", question: "Q?", options: [] } },
        "unsupported_content",
      ],
      [
        { document: { file_id: "d", file_unique_id: "ud" }, caption: "PDF" },
        "unsupported_content",
      ],
      [{ pinned_message: { message_id: 1 } }, "service_message"],
      [{}, "empty"],
    ];
    let id = 40;
    for (const [extra, reason] of cases) {
      expect((await deliver(post(message(src, ++id, extra)))).kind).toBe(
        "polled",
      );
      expect(drops().at(-1)?.reason).toBe(reason);
    }
    expect(await entries(src)).toEqual([]);
  });

  // ── EARS-27: albums ──────────────────────────────────────────────────

  it("048 EARS-27: when the parts of one album arrive as separate updates, the system shall keep exactly one entry with the caption's text and the smallest part's preview, permalink and earliest date", async () => {
    const src = await source();
    const group = `album-${Date.now()}`;
    // Out of order: the captioned middle part first, the smallest last.
    for (const [id, extra] of [
      [1204, { caption: "Кадры со съёмок подкаста", photo: photo("a1204") }],
      [1205, { photo: photo("a1205") }],
      [1203, { photo: photo("a1203") }],
    ] as const) {
      const res = await deliver(
        post(message(src, id, { media_group_id: group, ...extra })),
      );
      expect(res.kind).toBe("polled");
    }
    const rows = await entries(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Кадры со съёмок подкаста",
      href: `https://t.me/${src.address}/1203`,
      source_ref: `${src.id}:1203`,
      media_group_id: group,
      preview_file_id: "a1203-1280",
      preview_state: "pending",
    });
    expect(rows[0]!.published_at.getTime()).toBe((base + 1203) * 1000);
    expect(await messageIds(rows[0]!.id)).toEqual([1203, 1204, 1205]);
    // A re-delivered part changes nothing.
    await deliver(
      post(
        message(src, 1205, { media_group_id: group, photo: photo("a1205") }),
      ),
    );
    expect(await entries(src)).toHaveLength(1);
  });

  // ── EARS-28: edits ───────────────────────────────────────────────────

  it("048 EARS-28: when an edit arrives for a post that has an entry, the system shall rewrite its text and changed preview in place, keeping its date and hidden state", async () => {
    const src = await source();
    await deliver(
      post(message(src, 50, { caption: "Было", photo: photo("e50") })),
    );
    const [before] = await entries(src);
    await pool.query(
      "UPDATE feed_entries SET hidden_at = now(), preview_state = 'done', image_ref = 'materials/feed/x.webp' WHERE id = $1",
      [before!.id],
    );
    const hidden = (await entries(src))[0]!.hidden_at;
    // Text-only edit: the medium is the same, the preview is kept.
    await deliver(
      edit(
        message(src, 50, {
          caption: "Стало",
          photo: photo("e50"),
          edit_date: base + 99,
        }),
      ),
    );
    let [after] = await entries(src);
    expect(after).toMatchObject({
      id: before!.id,
      title: "Стало",
      preview_state: "done",
      image_ref: "materials/feed/x.webp",
    });
    expect(after!.published_at).toEqual(before!.published_at);
    expect(after!.hidden_at).toEqual(hidden);
    // A replaced medium queues a new preview copy.
    await deliver(
      edit(message(src, 50, { caption: "Стало", photo: photo("e50b") })),
    );
    [after] = await entries(src);
    // The count restarts for the new medium; its immediate copy attempt
    // found no file in the double, so it is counted once and the old copy
    // stays on the card until a new one replaces it (EARS-29).
    expect(after).toMatchObject({
      preview_file_id: "e50b-1280",
      preview_file_unique_id: "u-e50b-1280",
      preview_state: "pending",
      preview_attempts: 1,
      image_ref: "materials/feed/x.webp",
    });
    expect(after!.published_at).toEqual(before!.published_at);
    expect(await entries(src)).toHaveLength(1);
  });

  it("048 EARS-28: when an edit arrives for a post that has no entry, the system shall process it as a new post", async () => {
    const src = await source();
    await deliver(edit(message(src, 60, { text: "Правка неизвестного" })));
    const rows = await entries(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Правка неизвестного",
      href: `https://t.me/${src.address}/60`,
    });
  });

  // ── EARS-36: nothing secret or raw is stored ─────────────────────────

  it("048 EARS-36: the system shall store only the card fields, the message ids and the preview state — never the raw update, the author signature or a file link", async () => {
    const src = await source();
    await deliver(
      post(message(src, 70, { caption: "Публикация", photo: photo("s70") })),
    );
    const [row] = await entries(src);
    const { rows: stored } = await pool.query<{ j: string }>(
      `SELECT row_to_json(e)::text AS j FROM feed_entries e WHERE e.id = $1
         UNION ALL SELECT row_to_json(m)::text FROM feed_entry_messages m WHERE m.feed_entry_id = $1
         UNION ALL SELECT row_to_json(s)::text FROM feed_sources s WHERE s.id = $2`,
      [row!.id, src.id],
    );
    const { rows: audit } = await pool.query<{ j: string }>(
      `SELECT row_to_json(a)::text AS j FROM audit_ledger a
          WHERE a.metadata->'pk'->>'id' = $1 OR a.metadata->'pk'->>'feed_entry_id' = $1
             OR a.metadata::text LIKE $2`,
      [row!.id, `%${row!.id}%`],
    );
    const everything = [...stored, ...audit].map((r) => r.j).join("\n");
    expect(everything).not.toContain(SIGNATURE);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("api.telegram.org");
    expect(everything).not.toContain("sender_chat");
    expect(everything).not.toContain("update_id");
  });
});
